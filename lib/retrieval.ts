import { CHUNKS_BY_DOC, type Chunk } from "@/lib/chunks-data";

// Lightweight in-memory lexical retrieval (TF-IDF-ish), scoped to one document.
// Good enough for catalogs/factsheets with specific German product terms and
// part numbers; swap for embeddings + a vector store when scaling further.

const tokenize = (s: string): string[] =>
  (s.toLowerCase().match(/[a-z0-9äöüß®]+/gi) ?? []).filter((t) => t.length >= 2);

type DocIndex = {
  chunks: Chunk[];
  tf: Map<string, number>[];
  idf: (t: string) => number;
};

const cache = new Map<string, DocIndex>();

function indexFor(docId: string): DocIndex | null {
  const chunks = CHUNKS_BY_DOC[docId];
  if (!chunks) return null;
  const cached = cache.get(docId);
  if (cached) return cached;

  const df = new Map<string, number>();
  const tf = chunks.map((c) => {
    const counts = new Map<string, number>();
    for (const t of tokenize(c.text)) counts.set(t, (counts.get(t) ?? 0) + 1);
    for (const t of counts.keys()) df.set(t, (df.get(t) ?? 0) + 1);
    return counts;
  });
  const N = chunks.length;
  const idf = (t: string) => Math.log(1 + N / (1 + (df.get(t) ?? 0)));

  const index = { chunks, tf, idf };
  cache.set(docId, index);
  return index;
}

export function retrieve(docId: string, query: string, k = 8): Chunk[] {
  const index = indexFor(docId);
  if (!index) return [];
  const qTokens = [...new Set(tokenize(query))];
  if (!qTokens.length) return [];

  return index.chunks
    .map((chunk, i) => {
      let score = 0;
      for (const t of qTokens) {
        const f = index.tf[i].get(t);
        if (f) score += (1 + Math.log(f)) * index.idf(t);
      }
      return { chunk, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map((s) => s.chunk);
}

export function resolveChunk(docId: string, id: string): Chunk | undefined {
  return CHUNKS_BY_DOC[docId]?.find((c) => c.id === id);
}
