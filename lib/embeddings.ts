import { createAzure } from "@ai-sdk/azure";
import { google } from "@ai-sdk/google";
import { embed, embedMany, cosineSimilarity } from "ai";

// Kataloge mit mindestens so vielen Seiten nutzen Embedding-basiertes Retrieval (RAG);
// kleinere Kataloge senden das gesamte PDF an Gemini.
export const RAG_PAGE_THRESHOLD = 20;

// 768 Dimensionen halten die gespeicherten Vektoren klein; cosineSimilarity normalisiert sowieso.
const providerOptions = { google: { outputDimensionality: 768 } };

function getEmbeddingModel() {
  const azureApiKey = process.env.AZURE_API_KEY;
  const azureEmbeddingDeployment = process.env.AZURE_EMBEDDING_DEPLOYMENT;
  const azureResourceName = process.env.AZURE_RESOURCE_NAME;
  const azureOpenAiEndpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const hasAzure =
    azureApiKey &&
    azureEmbeddingDeployment &&
    (azureResourceName || azureOpenAiEndpoint);

  if (hasAzure) {
    const azure = createAzure({
      apiKey: azureApiKey,
      resourceName: azureResourceName,
      baseURL: azureOpenAiEndpoint,
    });
    return azure.embedding(azureEmbeddingDeployment);
  }

  return google.textEmbedding("gemini-embedding-001");
}

// Gemini erlaubt maximal 100 Texte pro Batch-Request; das SDK teilt nicht
// selbst auf, also hier manuell stückeln.
const MAX_EMBED_BATCH = 100;

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const model = getEmbeddingModel();
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += MAX_EMBED_BATCH) {
    const { embeddings } = await embedMany({
      model,
      values: texts.slice(i, i + MAX_EMBED_BATCH),
      providerOptions,
      maxParallelCalls: 2,
    });
    out.push(...embeddings);
  }
  return out;
}

export async function embedQuery(text: string): Promise<number[]> {
  const { embedding } = await embed({
    model: getEmbeddingModel(),
    value: text,
    providerOptions,
  });
  return embedding;
}

export function topKIndices(
  query: number[],
  vectors: number[][],
  k: number,
): number[] {
  return vectors
    .map((v, i) => ({
      i,
      score: v.length === query.length ? cosineSimilarity(query, v) : -Infinity,
    }))
    .filter(({ score }) => Number.isFinite(score))
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map((x) => x.i);
}
