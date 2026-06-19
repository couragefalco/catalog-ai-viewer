import { google } from "@ai-sdk/google";
import { embed, embedMany, cosineSimilarity } from "ai";

// Kataloge mit mindestens so vielen Seiten nutzen Embedding-basiertes Retrieval (RAG);
// kleinere Kataloge senden das gesamte PDF an Gemini.
export const RAG_PAGE_THRESHOLD = 20;

const MODEL = google.textEmbedding("gemini-embedding-001");
// 768 Dimensionen halten die gespeicherten Vektoren klein; cosineSimilarity normalisiert sowieso.
const providerOptions = { google: { outputDimensionality: 768 } };

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const { embeddings } = await embedMany({
    model: MODEL,
    values: texts,
    providerOptions,
    maxParallelCalls: 2,
  });
  return embeddings;
}

export async function embedQuery(text: string): Promise<number[]> {
  const { embedding } = await embed({ model: MODEL, value: text, providerOptions });
  return embedding;
}

export function topKIndices(
  query: number[],
  vectors: number[][],
  k: number,
): number[] {
  return vectors
    .map((v, i) => ({ i, score: cosineSimilarity(query, v) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map((x) => x.i);
}
