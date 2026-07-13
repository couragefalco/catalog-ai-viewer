import { cosineSimilarity } from "ai";
import { embedTexts } from "@/lib/embeddings";
import { decodePageIndex, searchPages, truncate } from "@/lib/page-index";
import { planQueries } from "@/lib/query-plan";
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
// 1) Vorauswahl auf SEITEN-Ebene (nicht Katalog-Ebene: ein Katalogvektor
//    verwässert, die eine relevante Passage geht im Mittel unter) plus ein
//    Keyword-Index für exakte Produktnamen. Beide Ranglisten werden vereinigt.
// 2) Chunk-Ebene: nur in den gewählten Katalogen, mit den vollen Chunk-Vektoren.
//
// Mehrteilige Fragen werden vorher in Teilfragen zerlegt (lib/query-plan) und
// jede Stufe läuft je Teilfrage mit eigenem Kontingent - ein über zwei Themen
// gemittelter Fragevektor trifft sonst keines von beiden.

const PAGE_HITS = 60; // Seiten aus der semantischen Vorauswahl
const SEMANTIC_CATALOGS = 18; // daraus abgeleitete Kataloge (gesamt)
const LEXICAL_CATALOGS = 8; // Plätze für die Begriffs-Rangliste (gesamt)
export const MAX_CHUNKS = 24;
export const MAX_CHUNKS_PER_CATALOG = 6;

export type Candidate = {
  id: string;
  catalogId: string;
  catalogName: string;
  chunk: Chunk;
  score: number; // bester Score über alle Teilfragen
  perQuery: number[]; // Score je Teilfrage, für die Kontingente
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

async function selectCatalogs(
  queries: string[],
  queryVectors: number[][],
  metas: CatalogMeta[],
  diag?: RetrievalDiagnostics,
): Promise<CatalogMeta[]> {
  if (metas.length <= SEMANTIC_CATALOGS + LEXICAL_CATALOGS) return metas;
  const byId = new Map(metas.map((m) => [m.id, m]));

  const [pageBlob, searchIndex] = await Promise.all([
    queryVectors.length ? getPageIndexCached().catch(() => null) : null,
    getSearchIndexCached().catch(() => null),
  ]);

  const perQuerySemantic = Math.max(
    6,
    Math.ceil(SEMANTIC_CATALOGS / Math.max(1, queryVectors.length)),
  );
  const perQueryLexical = Math.max(
    3,
    Math.ceil(LEXICAL_CATALOGS / Math.max(1, queries.length)),
  );

  const selected = new Map<string, CatalogMeta>();
  const via = (meta: CatalogMeta, how: string) => {
    if (!selected.has(meta.id)) {
      selected.set(meta.id, meta);
      diag?.selectedCatalogs.push({ id: meta.id, name: meta.name, via: how });
    }
  };

  const index = pageBlob ? decodePageIndex(pageBlob) : null;
  const summaries =
    !index && queryVectors.length
      ? await getSummaryVectorsCached().catch(() => null)
      : null;

  queryVectors.forEach((queryVector, q) => {
    let taken = 0;
    if (index) {
      const hits = searchPages(
        truncate(queryVector, index.dims),
        index,
        PAGE_HITS,
      );
      for (const { entry, score } of hits) {
        if (taken >= perQuerySemantic) break;
        const meta = byId.get(entry.c);
        if (!meta) continue;
        if (selected.has(meta.id)) continue;
        diag?.pageHits.push({
          query: queries[q] ?? "",
          catalog: meta.name,
          page: entry.p,
          score: +score.toFixed(3),
        });
        via(meta, `seite:${q}`);
        taken++;
      }
    } else if (summaries) {
      for (const meta of topN(
        metas,
        (m) => {
          const summary = summaries[m.id];
          return summary && summary.length === queryVector.length
            ? cosineSimilarity(queryVector, summary)
            : -Infinity;
        },
        perQuerySemantic,
      )) {
        via(meta, `katalogvektor:${q}`);
      }
    }
  });

  queries.forEach((query, q) => {
    const candidates: CatalogMeta[] = searchIndex
      ? [...lexicalScores(query, searchIndex).entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, perQueryLexical)
          .map(([docIndex]) => byId.get(searchIndex.ids[docIndex]))
          .filter((m): m is CatalogMeta => Boolean(m))
      : topN(
          metas,
          (meta) =>
            lexicalScore(
              query,
              meta.name,
              `${meta.category ?? ""} ${meta.quickId ?? ""} ${meta.series ?? ""} ${meta.notes}`,
            ),
          perQueryLexical,
        );
    for (const meta of candidates) via(meta, `begriff:${q}`);
  });

  return selected.size ? [...selected.values()] : metas.slice(0, SEMANTIC_CATALOGS);
}

// Jede Teilfrage bekommt ihr eigenes Kontingent an Fundstellen, damit die
// Belege zur zweiten Teilfrage nicht von der ersten verdrängt werden. Was
// danach frei ist, wird mit den global besten Stellen aufgefüllt.
export function selectChunks(
  scored: Candidate[],
  queryCount: number,
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

  const quota = Math.max(1, Math.floor(MAX_CHUNKS / Math.max(1, queryCount)));
  for (let q = 0; q < queryCount; q++) {
    const ranked = [...scored].sort(
      (a, b) => (b.perQuery[q] ?? 0) - (a.perQuery[q] ?? 0),
    );
    let takenForQuery = 0;
    for (const candidate of ranked) {
      if (takenForQuery >= quota) break;
      if (tryTake(candidate)) takenForQuery++;
    }
  }

  for (const candidate of [...scored].sort((a, b) => b.score - a.score)) {
    tryTake(candidate);
  }
  return chosen;
}

export async function retrieveCandidates(
  question: string,
  diag?: RetrievalDiagnostics,
): Promise<Candidate[]> {
  const queries = await planQueries(question);
  diag?.queries.push(...queries);

  const [allMetas, queryVectors] = await Promise.all([
    listCatalogsCached(),
    embedTexts(queries).catch(() => [] as number[][]),
  ]);
  const metas = await selectCatalogs(queries, queryVectors, allMetas, diag);

  const records = await Promise.all(
    metas.map(async (meta, catalogIndex) => {
      const [record, vectors] = await Promise.all([
        getCatalog(meta.id),
        queryVectors.length ? getCatalogVectors(meta.id).catch(() => null) : null,
      ]);
      return { record, vectors, catalogIndex };
    }),
  );

  const scored = records
    .filter(
      (
        entry,
      ): entry is NonNullable<typeof entry> & {
        record: NonNullable<typeof entry.record>;
      } => Boolean(entry.record),
    )
    .flatMap(({ record, vectors, catalogIndex }) => {
      const dims = queryVectors[0]?.length;
      const vectorUsable =
        vectors &&
        vectors.length === record.chunks.length &&
        vectors[0]?.length === dims;

      return record.chunks.map((chunk, chunkIndex) => {
        const perQuery = queries.map((query, q) => {
          const vectorScore = vectorUsable
            ? cosineSimilarity(queryVectors[q], vectors[chunkIndex])
            : -Infinity;
          const textScore = lexicalScore(query, record.name, chunk.text);
          return Number.isFinite(vectorScore)
            ? vectorScore + textScore * 0.05
            : textScore;
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

  return selectChunks(scored, queries.length);
}
