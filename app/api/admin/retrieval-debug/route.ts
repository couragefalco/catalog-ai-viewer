import {
  retrieveCandidates,
  type RetrievalDiagnostics,
} from "@/lib/global-retrieval";

// Diagnose für die globale Suche: läuft durch DENSELBEN Code wie der Chat und
// zeigt Teilfragen, gewählte Kataloge und die belegten Fundstellen.
// Tokengeschützt; ohne REEMBED_TOKEN inert.

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: Request) {
  const token = process.env.REEMBED_TOKEN;
  if (!token || req.headers.get("x-reembed-token") !== token) {
    return Response.json({ error: "Nicht autorisiert" }, { status: 401 });
  }
  const { query } = (await req.json()) as { query: string };

  const diag: RetrievalDiagnostics = {
    queries: [],
    selectedCatalogs: [],
    pageHits: [],
  };
  const candidates = await retrieveCandidates(query, diag);

  return Response.json({
    queries: diag.queries,
    selectedCatalogs: diag.selectedCatalogs,
    topPageHits: diag.pageHits.slice(0, 20),
    chunks: candidates.slice(0, 16).map((c) => ({
      catalog: c.catalogName,
      page: c.chunk.page,
      score: +c.score.toFixed(3),
      perQuery: c.perQuery.map((s) => +s.toFixed(3)),
      text: c.chunk.text.slice(0, 120),
    })),
  });
}
