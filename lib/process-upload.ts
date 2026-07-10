import { enrichCatalog } from "@/lib/enrich";
import { ingestPdf, slugify } from "@/lib/ingest";
import {
  saveCatalog,
  saveCatalogVectors,
  uniqueId,
  upsertSummaryVector,
} from "@/lib/store";
import { RAG_PAGE_THRESHOLD, embedTexts } from "@/lib/embeddings";
import type { CatalogRecord } from "@/lib/catalog";

// Vektoren runden, damit der gebündelte Summary-Blob klein bleibt.
const roundVector = (v: number[]) => v.map((x) => Math.round(x * 1e5) / 1e5);

export async function buildSummaryVector(
  record: Pick<CatalogRecord, "name" | "notes" | "category" | "chunks">,
): Promise<number[] | null> {
  const sample = record.chunks
    .slice(0, 20)
    .map((c) => c.text)
    .join(" ")
    .slice(0, 4000);
  const text = [record.name, record.category, record.notes, sample]
    .filter(Boolean)
    .join("\n");
  const [vector] = await embedTexts([text]);
  return vector ? roundVector(vector) : null;
}

export type UploadPreset = {
  id?: string;
  name?: string;
  category?: string;
  series?: string;
  quickId?: string;
  sourceFile?: string;
  notes?: string;
  exampleQuestions?: string[];
  skipEnrichment?: boolean; // Bulk-Import: Metadaten kommen aus dem CSV
};

export async function processUpload(
  bytes: Uint8Array,
  filename: string,
  options?: { workspaceId?: string; questionLimit?: number },
  preset?: UploadPreset,
): Promise<{
  id: string;
  name: string;
  numPages: number;
  mode: "full" | "rag";
  notes: string;
  exampleQuestions: string[];
}> {
  void options;
  const { numPages, chunks } = await ingestPdf(bytes); // throws on bad PDF
  const id = preset?.id ?? (await uniqueId(slugify(filename) || "katalog"));
  const fallbackName = preset?.name ?? filename.replace(/\.pdf$/i, "");
  const enriched = preset?.skipEnrichment
    ? {
        name: fallbackName,
        notes: preset?.notes ?? "",
        exampleQuestions: preset?.exampleQuestions ?? [],
      }
    : await enrichCatalog({
        fallbackName,
        sampleText: chunks.slice(0, 40).map((c) => c.text).join("\n"),
      });
  const mode: "full" | "rag" = numPages >= RAG_PAGE_THRESHOLD ? "rag" : "full";
  const record: CatalogRecord = {
    id,
    name: preset?.name ?? enriched.name,
    numPages,
    notes: preset?.notes ?? enriched.notes,
    exampleQuestions: preset?.exampleQuestions ?? enriched.exampleQuestions,
    createdAt: new Date().toISOString(),
    mode,
    category: preset?.category,
    series: preset?.series,
    quickId: preset?.quickId,
    sourceFile: preset?.sourceFile ?? filename,
    chunks,
  };
  await saveCatalog(record, bytes);
  if (mode === "rag") {
    const vectors = await embedTexts(chunks.map((c) => c.text));
    await saveCatalogVectors(id, vectors);
  }
  const summaryVector = await buildSummaryVector(record).catch(() => null);
  if (summaryVector) await upsertSummaryVector(id, summaryVector);
  return {
    id,
    name: record.name,
    numPages,
    mode,
    notes: record.notes,
    exampleQuestions: record.exampleQuestions,
  };
}
