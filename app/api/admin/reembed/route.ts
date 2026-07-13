import { embedTexts } from "@/lib/embeddings";
import { roundVector, searchTextFor, summaryTextFor } from "@/lib/process-upload";
import { uniqueTerms } from "@/lib/search-index";
import {
  getCatalog,
  getSummaryVectors,
  listCatalogs,
  saveCatalogVectors,
  saveSummaryVectors,
} from "@/lib/store";

// Wartungsroute: rechnet Chunk- und Summary-Vektoren mit dem AKTUELL
// konfigurierten Embedding-Provider neu und liefert die Suchbegriffe pro
// Katalog zurück. Serverseitig, weil die Azure-Zugangsdaten nur zur Laufzeit
// verfügbar sind. Auth über REEMBED_TOKEN; ohne die Variable ist die Route inert.
//
// Aufruf in Scheiben (offset/limit), bis nextOffset null ist.
// mode=collect gibt Summary-Vektoren und Terme in der Antwort zurück, statt die
// gemeinsamen Index-Blobs pro Scheibe zu überschreiben: Blob-Reads sind nach
// einem Overwrite bis zu ~60s stale, ein Read-Modify-Write über viele Scheiben
// verliert dadurch Einträge. Der Aufrufer aggregiert und schreibt einmal.

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
  const collect = searchParams.get("mode") === "collect";
  // chunks=1: zusätzlich die Chunk-Vektoren jedes Katalogs neu berechnen.
  const withChunks = searchParams.get("chunks") === "1";

  const metas = await listCatalogs();
  const slice = metas.slice(offset, offset + limit);

  const summaries: { id: string; text: string }[] = [];
  const terms: Record<string, string[]> = {};
  let chunksEmbedded = 0;

  for (const meta of slice) {
    const record = await getCatalog(meta.id);
    if (!record) continue;
    summaries.push({ id: record.id, text: summaryTextFor(record) });
    terms[record.id] = uniqueTerms(searchTextFor(record));
    if (withChunks && record.chunks.length) {
      const vectors = await embedTexts(record.chunks.map((c) => c.text));
      await saveCatalogVectors(record.id, vectors);
      chunksEmbedded += vectors.length;
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
    chunksEmbedded,
    vectorDims: vectors[0]?.length ?? null,
    nextOffset,
    ...(collect ? { vectors: byId, terms } : {}),
  });
}
