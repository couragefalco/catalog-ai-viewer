import { enrichCatalog } from "@/lib/enrich";
import { ingestPdf, slugify } from "@/lib/ingest";
import { saveCatalog, saveCatalogVectors, uniqueId } from "@/lib/store";
import { RAG_PAGE_THRESHOLD, embedTexts } from "@/lib/embeddings";
import type { CatalogRecord } from "@/lib/catalog";

export async function processUpload(
  bytes: Uint8Array,
  filename: string,
  _options?: { workspaceId?: string; questionLimit?: number },
): Promise<{
  id: string;
  name: string;
  numPages: number;
  mode: "full" | "rag";
  notes: string;
  exampleQuestions: string[];
}> {
  const { numPages, chunks } = ingestPdf(bytes); // throws on bad PDF
  const id = await uniqueId(slugify(filename) || "katalog");
  const sampleText = chunks.slice(0, 40).map((c) => c.text).join("\n");
  const enriched = await enrichCatalog({
    fallbackName: filename.replace(/\.pdf$/i, ""),
    sampleText,
  });
  const mode: "full" | "rag" = numPages >= RAG_PAGE_THRESHOLD ? "rag" : "full";
  const record: CatalogRecord = {
    id,
    name: enriched.name,
    numPages,
    notes: enriched.notes,
    exampleQuestions: enriched.exampleQuestions,
    createdAt: new Date().toISOString(),
    mode,
    chunks,
  };
  await saveCatalog(record, bytes);
  if (mode === "rag") {
    const vectors = await embedTexts(chunks.map((c) => c.text));
    await saveCatalogVectors(id, vectors);
  }
  return {
    id,
    name: record.name,
    numPages,
    mode,
    notes: record.notes,
    exampleQuestions: record.exampleQuestions,
  };
}
