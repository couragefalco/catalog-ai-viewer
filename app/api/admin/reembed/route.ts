import { embedTexts } from "@/lib/embeddings";
import { roundVector, summaryTextFor } from "@/lib/process-upload";
import {
  getCatalog,
  getSummaryVectors,
  listCatalogs,
  saveCatalogVectors,
  saveSummaryVectors,
} from "@/lib/store";

// Wartungsroute: Summary- und Chunk-Vektoren mit dem AKTUELL konfigurierten
// Embedding-Provider neu berechnen (z. B. nach Wechsel Gemini -> Azure).
// Serverseitig, weil die Azure-Zugangsdaten nur zur Laufzeit verfügbar sind.
// Auth über REEMBED_TOKEN-Env-Var; ohne gesetzte Variable ist die Route inert.
// Aufruf in Scheiben (offset/limit), bis nextOffset null ist.

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request) {
  const token = process.env.REEMBED_TOKEN;
  const provided = req.headers.get("x-reembed-token");
  if (!token || !provided || provided !== token) {
    return Response.json({ error: "Nicht autorisiert" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const offset = Math.max(0, Number(searchParams.get("offset") ?? "0") || 0);
  const limit = Math.min(
    200,
    Math.max(1, Number(searchParams.get("limit") ?? "60") || 60),
  );
  // mode=collect: Vektoren in der Antwort zurückgeben statt den gemeinsamen
  // Summary-Blob pro Scheibe zu überschreiben. Blob-Reads nach Overwrites
  // können bis zu ~60s stale sein; Read-Modify-Write über viele Scheiben
  // verliert dadurch Einträge. Der Aufrufer aggregiert und schreibt einmal.
  const collect = searchParams.get("mode") === "collect";

  const metas = await listCatalogs();
  const slice = metas.slice(offset, offset + limit);

  const summaries: { id: string; text: string }[] = [];
  let ragReembedded = 0;
  for (const meta of slice) {
    const record = await getCatalog(meta.id);
    if (!record) continue;
    summaries.push({ id: record.id, text: summaryTextFor(record) });
    if (record.mode === "rag") {
      const vectors = await embedTexts(record.chunks.map((c) => c.text));
      await saveCatalogVectors(record.id, vectors);
      ragReembedded++;
    }
  }

  const vectors = await embedTexts(summaries.map((s) => s.text));
  const byId: Record<string, number[]> = {};
  summaries.forEach((s, i) => {
    if (vectors[i]) byId[s.id] = roundVector(vectors[i]);
  });

  if (!collect) {
    const existing = (await getSummaryVectors()) ?? {};
    await saveSummaryVectors({ ...existing, ...byId });
  }

  const nextOffset =
    offset + slice.length < metas.length ? offset + slice.length : null;
  return Response.json({
    total: metas.length,
    offset,
    processed: slice.length,
    ragReembedded,
    vectorDims: vectors[0]?.length ?? null,
    nextOffset,
    ...(collect ? { vectors: byId } : {}),
  });
}
