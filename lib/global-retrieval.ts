import { cosineSimilarity } from "ai";
import { embedTexts } from "@/lib/embeddings";
import { decodePageIndex, searchPages, truncate } from "@/lib/page-index";
import { planTopics } from "@/lib/query-plan";
import { lexicalScores } from "@/lib/search-index";
import {
  getCatalog,
  getCatalogVectors,
  getPageIndexCached,
  getSearchIndexCached,
  getSummaryVectorsCached,
  listCatalogsCached,
} from "@/lib/store";
import type { CatalogMeta, Chunk } from "@/lib/catalog";

// Zweistufige Suche über >1000 Kataloge:
//
// 1) Vorauswahl auf SEITEN-Ebene, nicht auf Katalog-Ebene: ein Vektor pro
//    Katalog verwässert, die eine gesuchte Passage geht im Mittel unter und der
//    Katalog kommt nie in die engere Wahl. Dazu ein Keyword-Index für exakte
//    Produktnamen ("igumid", "PRT-01"), die die Semantik übersieht.
// 2) Chunk-Ebene: nur in den gewählten Katalogen, mit den vollen Chunk-Vektoren.
//
// Die Frage wird vorher in Themen zerlegt, jedes in Deutsch UND Englisch
// (siehe lib/query-plan). Jedes Thema bekommt in beiden Stufen ein eigenes
// Kontingent, damit das zweite Thema nicht vom ersten verdrängt wird.

const PAGE_HITS = 60; // betrachtete Seiten je Suchvariante
const SEMANTIC_CATALOGS = 18; // Kataloge aus der semantischen Vorauswahl
const LEXICAL_CATALOGS = 8; // Kataloge aus der Begriffs-Rangliste
export const MAX_CHUNKS = 24;
export const MAX_CHUNKS_PER_CATALOG = 6;
// Ein Treffer bringt den Rest SEINER SEITE mit.
//
// Der Materialkatalog listet die igumid®-Sorten als eigene Absätze. Die Suche
// trifft zuverlässig einen davon - aber der Absatz zum Basiswerkstoff
// igumid® G LW ("Dauertemperaturen von -40 °C bis deutlich über 100 °C") stand
// daneben und fiel unter den Deckel je Katalog. Die Seite ist die Einheit, in
// der solche Kataloge geschrieben sind; wer einen Absatz trifft, braucht meist
// die Nachbarn dazu.
// Die Saat wird JE THEMA gewählt: nach reinem Score kämen alle Saatkörner aus
// dem Thema mit den höheren Ähnlichkeiten, und die Seite zum zweiten Thema
// bliebe wieder unergänzt.
const PAGE_EXPANSION_SEEDS_PER_TOPIC = 2;
const MAX_PAGE_SIBLINGS = 8; // je Saatkorn, damit eine volle Seite nicht flutet
export const MAX_CHUNKS_WITH_CONTEXT = 40;

export type Candidate = {
  id: string;
  catalogId: string;
  catalogName: string;
  chunk: Chunk;
  score: number; // bester Score über alle Themen
  perQuery: number[]; // Score je THEMA (beste Sprachvariante), für die Kontingente
};

export type RetrievalDiagnostics = {
  queries: string[];
  selectedCatalogs: { id: string; name: string; via: string }[];
  pageHits: { query: string; catalog: string; page: number; score: number }[];
};

export function lexicalScore(
  question: string,
  catalogName: string,
  text: string,
) {
  const haystack = `${catalogName} ${text}`.toLowerCase();
  const terms = question
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((term) => term.length > 2);
  if (terms.length === 0) return 0;

  const uniqueTerms = [...new Set(terms)];
  const matched = uniqueTerms.filter((term) => haystack.includes(term)).length;
  const phraseBoost = haystack.includes(question.toLowerCase()) ? 3 : 0;
  return matched / uniqueTerms.length + phraseBoost;
}

const topN = <T>(items: T[], score: (item: T) => number, n: number): T[] =>
  items
    .map((item) => ({ item, s: score(item) }))
    .filter(({ s }) => Number.isFinite(s) && s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, n)
    .map(({ item }) => item);

// Ein Thema, seine Formulierungen und deren Vektoren.
type PlannedTopic = { variants: string[]; vectors: number[][] };

async function selectCatalogs(
  topics: PlannedTopic[],
  metas: CatalogMeta[],
  diag?: RetrievalDiagnostics,
): Promise<CatalogMeta[]> {
  if (metas.length <= SEMANTIC_CATALOGS + LEXICAL_CATALOGS) return metas;
  const byId = new Map(metas.map((m) => [m.id, m]));

  const hasVectors = topics.some((t) => t.vectors.length > 0);
  const [pageBlob, searchIndex] = await Promise.all([
    hasVectors ? getPageIndexCached().catch(() => null) : null,
    getSearchIndexCached().catch(() => null),
  ]);

  const perTopicSemantic = Math.max(
    6,
    Math.ceil(SEMANTIC_CATALOGS / topics.length),
  );
  const perTopicLexical = Math.max(
    3,
    Math.ceil(LEXICAL_CATALOGS / topics.length),
  );

  const selected = new Map<string, CatalogMeta>();
  const take = (meta: CatalogMeta, how: string) => {
    if (selected.has(meta.id)) return false;
    selected.set(meta.id, meta);
    diag?.selectedCatalogs.push({ id: meta.id, name: meta.name, via: how });
    return true;
  };

  const index = pageBlob ? decodePageIndex(pageBlob) : null;
  const summaries =
    !index && hasVectors ? await getSummaryVectorsCached().catch(() => null) : null;

  topics.forEach((topic, t) => {
    // Beste Seiten über ALLE Sprachvarianten des Themas: eine Seite zählt mit
    // ihrer besten Übereinstimmung, nicht mit der zufällig gleichsprachigen.
    if (index) {
      const best = new Map<string, { page: number; score: number; query: string }>();
      topic.vectors.forEach((vector, v) => {
        for (const { entry, score } of searchPages(
          truncate(vector, index.dims),
          index,
          PAGE_HITS,
        )) {
          const current = best.get(entry.c);
          if (!current || score > current.score) {
            best.set(entry.c, {
              page: entry.p,
              score,
              query: topic.variants[v] ?? "",
            });
          }
        }
      });

      let taken = 0;
      for (const [catalogId, hit] of [...best.entries()].sort(
        (a, b) => b[1].score - a[1].score,
      )) {
        if (taken >= perTopicSemantic) break;
        const meta = byId.get(catalogId);
        if (!meta) continue;
        if (take(meta, `seite:${t}`)) {
          diag?.pageHits.push({
            query: hit.query,
            catalog: meta.name,
            page: hit.page,
            score: +hit.score.toFixed(3),
          });
          taken++;
        }
      }
    } else if (summaries) {
      // Fallback ohne Seiten-Index: alte Katalog-Vektoren.
      for (const meta of topN(
        metas,
        (m) => {
          const summary = summaries[m.id];
          if (!summary) return -Infinity;
          const scores = topic.vectors
            .filter((v) => v.length === summary.length)
            .map((v) => cosineSimilarity(v, summary));
          return scores.length ? Math.max(...scores) : -Infinity;
        },
        perTopicSemantic,
      )) {
        take(meta, `katalogvektor:${t}`);
      }
    }
  });

  topics.forEach((topic, t) => {
    const scores = new Map<number, number>();
    for (const variant of topic.variants) {
      if (!searchIndex) break;
      for (const [doc, score] of lexicalScores(variant, searchIndex)) {
        scores.set(doc, Math.max(scores.get(doc) ?? 0, score));
      }
    }
    const candidates: CatalogMeta[] = searchIndex
      ? [...scores.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, perTopicLexical)
          .map(([docIndex]) => byId.get(searchIndex.ids[docIndex]))
          .filter((m): m is CatalogMeta => Boolean(m))
      : topN(
          metas,
          (meta) =>
            Math.max(
              ...topic.variants.map((variant) =>
                lexicalScore(
                  variant,
                  meta.name,
                  `${meta.category ?? ""} ${meta.quickId ?? ""} ${meta.series ?? ""} ${meta.notes}`,
                ),
              ),
            ),
          perTopicLexical,
        );
    for (const meta of candidates) take(meta, `begriff:${t}`);
  });

  return selected.size ? [...selected.values()] : metas.slice(0, SEMANTIC_CATALOGS);
}

// Jedes Thema bekommt sein eigenes Kontingent an Fundstellen, damit die Belege
// zum zweiten Thema nicht vom ersten verdrängt werden. Der Rest wird mit den
// global besten Stellen aufgefüllt.
export function selectChunks(
  scored: Candidate[],
  topicCount: number,
): Candidate[] {
  const chosen: Candidate[] = [];
  const taken = new Set<string>();
  const perCatalog = new Map<string, number>();

  const tryTake = (candidate: Candidate) => {
    if (chosen.length >= MAX_CHUNKS || taken.has(candidate.id)) return false;
    const used = perCatalog.get(candidate.catalogId) ?? 0;
    if (used >= MAX_CHUNKS_PER_CATALOG) return false;
    taken.add(candidate.id);
    perCatalog.set(candidate.catalogId, used + 1);
    chosen.push(candidate);
    return true;
  };

  // 1) Kontingent je Thema.
  const quota = Math.max(1, Math.floor(MAX_CHUNKS / Math.max(1, topicCount)));
  for (let t = 0; t < topicCount; t++) {
    const ranked = [...scored].sort(
      (a, b) => (b.perQuery[t] ?? 0) - (a.perQuery[t] ?? 0),
    );
    let takenForTopic = 0;
    for (const candidate of ranked) {
      if (takenForTopic >= quota) break;
      if (tryTake(candidate)) takenForTopic++;
    }
  }

  // 2) Seiten-Kontext VOR dem Auffüllen: sonst sind die Plätze von global
  //    hoch bewerteten Einzelstellen belegt und ausgerechnet die Nachbarn des
  //    besten Treffers fallen hinten runter.
  const seeds: Candidate[] = [];
  for (let t = 0; t < Math.max(1, topicCount); t++) {
    for (const candidate of [...chosen]
      .sort((a, b) => (b.perQuery[t] ?? 0) - (a.perQuery[t] ?? 0))
      .slice(0, PAGE_EXPANSION_SEEDS_PER_TOPIC)) {
      if (!seeds.includes(candidate)) seeds.push(candidate);
    }
  }
  // Reihum je Saatkorn EINEN Nachbarn nachlegen: würde man Saatkorn für
  // Saatkorn abarbeiten, verbrauchte das erste Thema alle freien Plätze und
  // die Seite des zweiten Themas bliebe wieder unergänzt.
  const pending = seeds.map((seed) =>
    scored.filter(
      (sibling) =>
        sibling.catalogId === seed.catalogId &&
        sibling.chunk.page === seed.chunk.page,
    ),
  );
  const cursors = seeds.map(() => 0);
  const addedPerSeed = seeds.map(() => 0);

  for (let round = 0; round < MAX_PAGE_SIBLINGS; round++) {
    let progressed = false;
    for (let s = 0; s < seeds.length; s++) {
      if (chosen.length >= MAX_CHUNKS_WITH_CONTEXT) break;
      if (addedPerSeed[s] >= MAX_PAGE_SIBLINGS) continue;
      while (cursors[s] < pending[s].length) {
        const sibling = pending[s][cursors[s]++];
        if (taken.has(sibling.id)) continue;
        taken.add(sibling.id);
        chosen.push(sibling);
        addedPerSeed[s]++;
        progressed = true;
        break;
      }
    }
    if (!progressed || chosen.length >= MAX_CHUNKS_WITH_CONTEXT) break;
  }

  // 3) Restplätze mit den global besten Stellen auffüllen.
  for (const candidate of [...scored].sort((a, b) => b.score - a.score)) {
    tryTake(candidate);
  }

  return chosen;
}

export async function retrieveCandidates(
  question: string,
  diag?: RetrievalDiagnostics,
): Promise<Candidate[]> {
  const planned = await planTopics(question);
  const flat = planned.flat();
  diag?.queries.push(...flat);

  const [allMetas, vectors] = await Promise.all([
    listCatalogsCached(),
    embedTexts(flat).catch(() => [] as number[][]),
  ]);

  // Vektoren wieder ihren Themen zuordnen.
  const topics: PlannedTopic[] = [];
  let cursor = 0;
  for (const variants of planned) {
    topics.push({
      variants,
      vectors: vectors.slice(cursor, cursor + variants.length),
    });
    cursor += variants.length;
  }

  const metas = await selectCatalogs(topics, allMetas, diag);
  const records = await Promise.all(
    metas.map(async (meta, catalogIndex) => {
      const [record, chunkVectors] = await Promise.all([
        getCatalog(meta.id),
        vectors.length ? getCatalogVectors(meta.id).catch(() => null) : null,
      ]);
      return { record, chunkVectors, catalogIndex };
    }),
  );

  const dims = vectors[0]?.length;
  const scored = records
    .filter(
      (
        entry,
      ): entry is NonNullable<typeof entry> & {
        record: NonNullable<typeof entry.record>;
      } => Boolean(entry.record),
    )
    .flatMap(({ record, chunkVectors, catalogIndex }) => {
      const vectorUsable =
        chunkVectors &&
        chunkVectors.length === record.chunks.length &&
        chunkVectors[0]?.length === dims;

      return record.chunks.map((chunk, chunkIndex) => {
        // Je Thema die BESTE Sprachvariante zählen: eine englische Fundstelle
        // soll nicht dadurch verlieren, dass die Frage deutsch gestellt war.
        const perQuery = topics.map((topic) => {
          const scores = topic.vectors.map((vector, v) => {
            const vectorScore = vectorUsable
              ? cosineSimilarity(vector, chunkVectors[chunkIndex])
              : -Infinity;
            const textScore = lexicalScore(
              topic.variants[v] ?? "",
              record.name,
              chunk.text,
            );
            return Number.isFinite(vectorScore)
              ? vectorScore + textScore * 0.05
              : textScore;
          });
          return scores.length ? Math.max(...scores) : 0;
        });

        return {
          id: `c${catalogIndex}-${chunk.id}`,
          catalogId: record.id,
          catalogName: record.name,
          chunk,
          score: Math.max(...perQuery),
          perQuery,
        };
      });
    })
    .filter((candidate) => candidate.score > 0);

  return selectChunks(scored, topics.length);
}
