import { requireAdmin } from "@/lib/admin-auth";
import { enrichCatalog } from "@/lib/enrich";
import { ingestPdf, slugify } from "@/lib/ingest";
import { saveCatalog, uniqueId } from "@/lib/store";
import type { CatalogRecord } from "@/lib/catalog";

export const maxDuration = 300; // large PDFs: allow time for mupdf extraction

export async function POST(req: Request) {
  if (!(await requireAdmin())) {
    return Response.json({ error: "Nicht autorisiert" }, { status: 401 });
  }
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File) || !file.name.toLowerCase().endsWith(".pdf")) {
    return Response.json({ error: "Bitte eine PDF-Datei hochladen." }, { status: 400 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  let numPages: number;
  let chunks;
  try {
    ({ numPages, chunks } = ingestPdf(bytes));
  } catch {
    return Response.json(
      { error: "PDF konnte nicht verarbeitet werden." },
      { status: 422 },
    );
  }

  const id = await uniqueId(slugify(file.name) || "katalog");
  const sampleText = chunks.slice(0, 40).map((c) => c.text).join("\n");
  const enriched = await enrichCatalog({
    fallbackName: file.name.replace(/\.pdf$/i, ""),
    sampleText,
  });
  const record: CatalogRecord = {
    id,
    name: enriched.name,
    numPages,
    notes: enriched.notes,
    exampleQuestions: enriched.exampleQuestions,
    createdAt: new Date().toISOString(),
    mode: numPages >= 20 ? "rag" : "full",
    chunks,
  };
  await saveCatalog(record, bytes);
  return Response.json({ id, name: record.name, numPages });
}
