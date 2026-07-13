import { cosineSimilarity, streamText, type ModelMessage } from "ai";
import { getChatModel } from "@/lib/chat-model";
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
import type { Citation } from "@/lib/types";

export const maxDuration = 60;
export const runtime = "nodejs";

type InMsg = { role: "user" | "assistant"; text: string };

type Candidate = {
  id: string;
  catalogId: string;
  catalogName: string;
  chunk: Chunk;
  score: number; // bester Score über alle Teilfragen
  perQuery: number[]; // Score je Teilfrage, für die Kontingente
};

function createPlainTextProtocolResponse(text: string) {
  return new Response(`${text}\x1e[]`, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}

function lexicalScore(question: string, catalogName: string, text: string) {
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

// Zweistufige Suche über >1000 Kataloge:
// 1) Vorauswahl auf SEITEN-Ebene (nicht Katalog-Ebene: ein Katalogvektor
//    verwässert, die eine relevante Passage geht im Mittel unter) plus ein
//    Keyword-Index für exakte Produktnamen. Beide Ranglisten werden vereinigt.
// 2) Chunk-Ebene: nur in den gewählten Katalogen, mit den vollen Chunk-Vektoren.
const PAGE_HITS = 60; // Seiten aus der semantischen Vorauswahl
const SEMANTIC_CATALOGS = 16; // daraus abgeleitete Kataloge
const LEXICAL_CATALOGS = 8; // Plätze für die Begriffs-Rangliste
export const MAX_CHUNKS = 24;
export const MAX_CHUNKS_PER_CATALOG = 6;

const topN = <T>(items: T[], score: (item: T) => number, n: number): T[] =>
  items
    .map((item) => ({ item, s: score(item) }))
    .filter(({ s }) => Number.isFinite(s) && s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, n)
    .map(({ item }) => item);

// Teilfragen bekommen je eigene Plätze in der Vorauswahl, damit die zweite
// Teilfrage nicht komplett von der ersten verdrängt wird.
async function selectCatalogs(
  queries: string[],
  queryVectors: number[][],
  metas: CatalogMeta[],
): Promise<CatalogMeta[]> {
  if (metas.length <= SEMANTIC_CATALOGS + LEXICAL_CATALOGS) return metas;
  const byId = new Map(metas.map((m) => [m.id, m]));

  const [pageBlob, searchIndex] = await Promise.all([
    queryVectors.length ? getPageIndexCached().catch(() => null) : null,
    getSearchIndexCached().catch(() => null),
  ]);

  const perQuerySemantic = Math.max(
    4,
    Math.ceil(SEMANTIC_CATALOGS / Math.max(1, queryVectors.length)),
  );
  const perQueryLexical = Math.max(
    3,
    Math.ceil(LEXICAL_CATALOGS / Math.max(1, queries.length)),
  );

  const selected = new Map<string, CatalogMeta>();

  // Semantisch: beste SEITEN je Teilfrage -> deren Kataloge.
  const index = pageBlob ? decodePageIndex(pageBlob) : null;
  const summaries =
    !index && queryVectors.length
      ? await getSummaryVectorsCached().catch(() => null)
      : null;

  for (const queryVector of queryVectors) {
    let taken = 0;
    if (index) {
      const hits = searchPages(
        truncate(queryVector, index.dims),
        index,
        PAGE_HITS,
      );
      for (const { entry } of hits) {
        if (taken >= perQuerySemantic) break;
        if (selected.has(entry.c)) continue;
        const meta = byId.get(entry.c);
        if (!meta) continue;
        selected.set(meta.id, meta);
        taken++;
      }
    } else if (summaries) {
      // Fallback ohne Seiten-Index: alte Katalog-Vektoren.
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
        selected.set(meta.id, meta);
      }
    }
  }

  // Begriffe: exakte Produkt-/Werkstoffnamen je Teilfrage.
  for (const query of queries) {
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
    for (const meta of candidates) selected.set(meta.id, meta);
  }

  return selected.size ? [...selected.values()] : metas.slice(0, SEMANTIC_CATALOGS);
}

async function getCandidates(question: string): Promise<Candidate[]> {
  // Mehrteilige Fragen zerlegen und je Teilfrage suchen - ein gemittelter
  // Vektor über zwei Themen trifft sonst keines von beiden.
  const queries = await planQueries(question);
  const [allMetas, queryVectors] = await Promise.all([
    listCatalogsCached(),
    embedTexts(queries).catch(() => [] as number[][]),
  ]);
  const metas = await selectCatalogs(queries, queryVectors, allMetas);
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
    .filter((entry): entry is NonNullable<typeof entry> & {
      record: NonNullable<typeof entry.record>;
    } => Boolean(entry.record))
    .flatMap(({ record, vectors, catalogIndex }) => {
      const dims = queryVectors[0]?.length;
      const vectorUsable =
        vectors && vectors.length === record.chunks.length &&
        vectors[0]?.length === dims;

      return record.chunks.map((chunk, chunkIndex) => {
        // Pro Teilfrage einen eigenen Score behalten, statt sie zu mitteln.
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

export async function POST(req: Request) {
  const { messages }: { messages: InMsg[] } = await req.json();
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  if (!lastUser) {
    return createPlainTextProtocolResponse("Stelle eine Frage zu den Katalogen.");
  }

  const candidateChunks = await getCandidates(lastUser.text);
  if (candidateChunks.length === 0) {
    return createPlainTextProtocolResponse(
      "Ich habe dazu keine passende Stelle in den Katalogen gefunden.",
    );
  }

  const candidates = candidateChunks
    .map(
      (c) =>
        `[${c.id}] (${c.catalogName}, Seite ${c.chunk.page}) ${c.chunk.text}`,
    )
    .join("\n");

  const system = `Du bist ein Assistent für mehrere Produktkataloge.
Beantworte Fragen auf Deutsch, präzise und ausschließlich auf Basis der unten aufgeführten Textauszüge.
Wenn etwas nicht in den Auszügen steht, sage das ehrlich.

ZITATE:
- Setze hinter jede Aussage einen Marker im Format [[source-id]].
- Verwende ausschließlich source-ids aus der folgenden Liste.
- Wenn mehrere Kataloge relevant sind, nenne klar, aus welchem Katalog die Aussage stammt.

=== ZITIER-KANDIDATEN ===
${candidates}
=== ENDE ===`;

  const modelMessages: ModelMessage[] = messages.map((m) => ({
    role: m.role,
    content: m.text,
  }));

  let result: ReturnType<typeof streamText>;
  try {
    result = streamText({
      model: getChatModel(),
      system,
      messages: modelMessages,
    });
  } catch (error) {
    console.error("global chat stream setup failed", error);
    return createPlainTextProtocolResponse(
      "Es gab einen Fehler bei der Anfrage.",
    );
  }

  const byId = new Map(candidateChunks.map((c) => [c.id, c]));
  const allowed = new Set(candidateChunks.map((c) => c.id));
  const buildCitations = (text: string): Citation[] => {
    const blocks = text.match(/\[\[[\s\S]*?\]\]/g) ?? [];
    const citedIds = [
      ...new Set(
        blocks
          .flatMap((block) => block.match(/c\d+-p\d+-b\d+/g) ?? [])
          .filter((id) => allowed.has(id)),
      ),
    ].slice(0, 12);

    return citedIds
      .map((id) => {
        const candidate = byId.get(id);
        return candidate
          ? {
              id,
              catalogId: candidate.catalogId,
              catalogName: candidate.catalogName,
              page: candidate.chunk.page,
              bbox: candidate.chunk.bbox,
              snippet: candidate.chunk.text.slice(0, 160),
            }
          : null;
      })
      .filter(Boolean) as Citation[];
  };

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let full = "";
      try {
        for await (const delta of result.textStream) {
          full += delta;
          controller.enqueue(encoder.encode(delta));
        }
        controller.enqueue(
          encoder.encode("\x1e" + JSON.stringify(buildCitations(full))),
        );
      } catch {
        if (!full) {
          controller.enqueue(
            encoder.encode("Es gab einen Fehler bei der Anfrage."),
          );
        }
        controller.enqueue(encoder.encode("\x1e[]"));
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
