import { enrichCatalog } from "@/lib/enrich";
import { ingestPdf, slugify } from "@/lib/ingest";
import {
  getSearchIndex,
  saveCatalog,
  saveCatalogVectors,
  saveSearchIndex,
  uniqueId,
  upsertSummaryVector,
} from "@/lib/store";
import { RAG_PAGE_THRESHOLD, embedTexts } from "@/lib/embeddings";
import { uniqueTerms } from "@/lib/search-index";
import type { CatalogRecord } from "@/lib/catalog";

// Vektoren runden, damit der gebündelte Summary-Blob klein bleibt.
export const roundVector = (v: number[]) =>
  v.map((x) => Math.round(x * 1e5) / 1e5);

// Der Summary-Vektor entscheidet in der globalen Suche, ob ein Katalog
// überhaupt in die engere Wahl kommt. Deshalb den kompletten Text einbeziehen
// (fast alle Kataloge sind 1-5 Seiten), nicht nur die ersten Blöcke - sonst
// bleiben Angaben aus dem hinteren Teil des Dokuments unsichtbar.
export function summaryTextFor(
  record: Pick<CatalogRecord, "name" | "notes" | "category" | "chunks">,
): string {
  const body = record.chunks
    .map((c) => c.text)
    .join(" ")
    .slice(0, 8000);
  return [record.name, record.category, record.notes, body]
    .filter(Boolean)
    .join("\n");
}

export function searchTextFor(
  record: Pick<CatalogRecord, "name" | "notes" | "category" | "quickId" | "series" | "chunks">,
): string {
  return [
    record.name,
    record.category,
    record.quickId,
    record.series,
    record.notes,
    record.chunks.map((c) => c.text).join(" "),
  ]
    .filter(Boolean)
    .join(" ");
}

export async function upsertSearchIndexEntry(
  record: Pick<CatalogRecord, "id" | "name" | "notes" | "category" | "quickId" | "series" | "chunks">,
): Promise<void> {
  const index = (await getSearchIndex()) ?? { ids: [], postings: {} };
  let docIndex = index.ids.indexOf(record.id);
  if (docIndex === -1) {
    docIndex = index.ids.length;
    index.ids.push(record.id);
  } else {
    for (const docs of Object.values(index.postings)) {
      const at = docs.indexOf(docIndex);
      if (at !== -1) docs.splice(at, 1);
    }
  }
  for (const term of uniqueTerms(searchTextFor(record))) {
    (index.postings[term] ??= []).push(docIndex);
  }
  await saveSearchIndex(index);
}

export async function buildSummaryVector(
  record: Pick<CatalogRecord, "name" | "notes" | "category" | "chunks">,
): Promise<number[] | null> {
  const [vector] = await embedTexts([summaryTextFor(record)]);
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
  // Chunk-Vektoren werden für JEDEN Katalog gespeichert, nicht nur für große:
  // die globale Suche bewertet Fundstellen quer über alle Kataloge semantisch.
  // "mode" steuert weiterhin nur den Dokument-Chat (volles PDF vs. Retrieval).
  if (chunks.length) {
    const vectors = await embedTexts(chunks.map((c) => c.text));
    await saveCatalogVectors(id, vectors);
  }
  const summaryVector = await buildSummaryVector(record).catch(() => null);
  if (summaryVector) await upsertSummaryVector(id, summaryVector);
  await upsertSearchIndexEntry(record).catch(() => {});
  return {
    id,
    name: record.name,
    numPages,
    mode,
    notes: record.notes,
    exampleQuestions: record.exampleQuestions,
  };
}
