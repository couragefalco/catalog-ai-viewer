import { cosineSimilarity, streamText, type ModelMessage } from "ai";
import { getChatModel } from "@/lib/chat-model";
import { embedQuery } from "@/lib/embeddings";
import { decodePageIndex, searchPages, truncate } from "@/lib/page-index";
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
  score: number;
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
const MAX_CHUNKS = 24;
const MAX_CHUNKS_PER_CATALOG = 6;

const topN = <T>(items: T[], score: (item: T) => number, n: number): T[] =>
  items
    .map((item) => ({ item, s: score(item) }))
    .filter(({ s }) => Number.isFinite(s) && s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, n)
    .map(({ item }) => item);

async function selectCatalogs(
  question: string,
  metas: CatalogMeta[],
  queryVector: number[] | null,
): Promise<CatalogMeta[]> {
  if (metas.length <= SEMANTIC_CATALOGS + LEXICAL_CATALOGS) return metas;
  const byId = new Map(metas.map((m) => [m.id, m]));

  const [pageBlob, searchIndex] = await Promise.all([
    queryVector ? getPageIndexCached().catch(() => null) : null,
    getSearchIndexCached().catch(() => null),
  ]);

  // Semantisch: beste Seiten -> deren Kataloge (Reihenfolge = Seiten-Rang).
  let bySemantics: CatalogMeta[] = [];
  if (queryVector && pageBlob) {
    const index = decodePageIndex(pageBlob);
    const hits = searchPages(truncate(queryVector, index.dims), index, PAGE_HITS);
    const seen = new Set<string>();
    for (const { entry } of hits) {
      if (seen.has(entry.c)) continue;
      seen.add(entry.c);
      const meta = byId.get(entry.c);
      if (meta) bySemantics.push(meta);
      if (bySemantics.length >= SEMANTIC_CATALOGS) break;
    }
  } else if (queryVector) {
    // Fallback ohne Seiten-Index: alte Katalog-Vektoren.
    const summaries = await getSummaryVectorsCached().catch(() => null);
    bySemantics = topN(
      metas,
      (meta) => {
        const summary = summaries?.[meta.id];
        return summary && summary.length === queryVector.length
          ? cosineSimilarity(queryVector, summary)
          : -Infinity;
      },
      SEMANTIC_CATALOGS,
    );
  }

  let byKeywords: CatalogMeta[] = [];
  if (searchIndex) {
    const scores = lexicalScores(question, searchIndex);
    byKeywords = [...scores.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, LEXICAL_CATALOGS)
      .map(([docIndex]) => byId.get(searchIndex.ids[docIndex]))
      .filter((m): m is CatalogMeta => Boolean(m));
  } else {
    byKeywords = topN(
      metas,
      (meta) =>
        lexicalScore(
          question,
          meta.name,
          `${meta.category ?? ""} ${meta.quickId ?? ""} ${meta.series ?? ""} ${meta.notes}`,
        ),
      LEXICAL_CATALOGS,
    );
  }

  const selected = new Map<string, CatalogMeta>();
  for (const meta of [...bySemantics, ...byKeywords]) selected.set(meta.id, meta);
  return selected.size ? [...selected.values()] : metas.slice(0, SEMANTIC_CATALOGS);
}

async function getCandidates(question: string): Promise<Candidate[]> {
  const [allMetas, queryVector] = await Promise.all([
    listCatalogsCached(),
    embedQuery(question).catch(() => null),
  ]);
  const metas = await selectCatalogs(question, allMetas, queryVector);
  const records = await Promise.all(
    metas.map(async (meta, catalogIndex) => {
      const [record, vectors] = await Promise.all([
        getCatalog(meta.id),
        queryVector ? getCatalogVectors(meta.id).catch(() => null) : null,
      ]);
      return { record, vectors, catalogIndex };
    }),
  );

  return records
    .filter((entry): entry is NonNullable<typeof entry> & {
      record: NonNullable<typeof entry.record>;
    } => Boolean(entry.record))
    .flatMap(({ record, vectors, catalogIndex }) => {
      const vectorUsable =
        queryVector &&
        vectors &&
        vectors.length === record.chunks.length &&
        vectors[0]?.length === queryVector.length;

      return record.chunks.map((chunk, chunkIndex) => {
        const vectorScore = vectorUsable
          ? cosineSimilarity(queryVector, vectors[chunkIndex])
          : -Infinity;
        const textScore = lexicalScore(question, record.name, chunk.text);
        const score = Number.isFinite(vectorScore)
          ? vectorScore + textScore * 0.05
          : textScore;

        return {
          id: `c${catalogIndex}-${chunk.id}`,
          catalogId: record.id,
          catalogName: record.name,
          chunk,
          score,
        };
      });
    })
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score)
    .reduce<Candidate[]>((kept, candidate) => {
      // Pro Katalog höchstens 6 Stellen, damit ein einzelner Katalog eine
      // mehrteilige Frage ("Werkstoff X UND Temperatur Y") nicht allein belegt.
      if (kept.length >= MAX_CHUNKS) return kept;
      const perCatalog = kept.filter(
        (c) => c.catalogId === candidate.catalogId,
      ).length;
      if (perCatalog >= MAX_CHUNKS_PER_CATALOG) return kept;
      kept.push(candidate);
      return kept;
    }, []);
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
