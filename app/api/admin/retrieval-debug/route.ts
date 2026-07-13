import { cosineSimilarity } from "ai";
import { embedQuery } from "@/lib/embeddings";
import { lexicalScores } from "@/lib/search-index";
import {
  getCatalog,
  getCatalogVectors,
  getSearchIndex,
  getSummaryVectors,
  listCatalogs,
} from "@/lib/store";

// Diagnose für die globale Suche: zeigt, welche Kataloge Stufe 1 (Semantik /
// Keywords) wählt und welche Fundstellen Stufe 2 liefert. Tokengeschützt.

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: Request) {
  const token = process.env.REEMBED_TOKEN;
  if (!token || req.headers.get("x-reembed-token") !== token) {
    return Response.json({ error: "Nicht autorisiert" }, { status: 401 });
  }
  const { query } = (await req.json()) as { query: string };

  const [metas, queryVector, summaries, searchIndex] = await Promise.all([
    listCatalogs(),
    embedQuery(query).catch((e) => {
      console.error("embedQuery failed", e);
      return null;
    }),
    getSummaryVectors().catch(() => null),
    getSearchIndex().catch(() => null),
  ]);

  const diag = {
    catalogs: metas.length,
    queryVectorDims: queryVector?.length ?? null,
    summaryVectors: summaries ? Object.keys(summaries).length : null,
    summaryDims: summaries ? Object.values(summaries)[0]?.length : null,
    searchIndexTerms: searchIndex ? Object.keys(searchIndex.postings).length : null,
    searchIndexDocs: searchIndex?.ids.length ?? null,
  };

  const bySemantics = queryVector
    ? metas
        .map((m) => {
          const s = summaries?.[m.id];
          return {
            id: m.id,
            name: m.name,
            score:
              s && s.length === queryVector.length
                ? cosineSimilarity(queryVector, s)
                : -Infinity,
          };
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, 10)
    : [];

  const lexTop: { id: string; name: string; score: number }[] = [];
  if (searchIndex) {
    const scores = lexicalScores(query, searchIndex);
    const byId = new Map(metas.map((m) => [m.id, m]));
    for (const [docIndex, score] of [...scores.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)) {
      const id = searchIndex.ids[docIndex];
      lexTop.push({ id, name: byId.get(id)?.name ?? "(unbekannt)", score });
    }
  }

  // Stufe 2 auf den vereinigten Kandidaten
  const ids = [...new Set([...bySemantics.map((c) => c.id), ...lexTop.map((c) => c.id)])];
  const chunks: {
    catalog: string;
    chunkId: string;
    score: number;
    vec: boolean;
    text: string;
  }[] = [];
  await Promise.all(
    ids.map(async (id) => {
      const [record, vectors] = await Promise.all([
        getCatalog(id),
        getCatalogVectors(id).catch(() => null),
      ]);
      if (!record || !queryVector) return;
      const usable =
        vectors &&
        vectors.length === record.chunks.length &&
        vectors[0]?.length === queryVector.length;
      record.chunks.forEach((c, i) => {
        chunks.push({
          catalog: record.name,
          chunkId: c.id,
          score: usable ? cosineSimilarity(queryVector, vectors[i]) : -1,
          vec: Boolean(usable),
          text: c.text.slice(0, 130),
        });
      });
    }),
  );
  chunks.sort((a, b) => b.score - a.score);

  return Response.json({
    diag,
    semanticTop: bySemantics.map((c) => ({ name: c.name, score: +c.score.toFixed(3) })),
    lexicalTop: lexTop.map((c) => ({ name: c.name, score: +c.score.toFixed(3) })),
    chunkTop: chunks.slice(0, 12).map((c) => ({
      catalog: c.catalog,
      score: +c.score.toFixed(3),
      vec: c.vec,
      text: c.text,
    })),
  });
}
