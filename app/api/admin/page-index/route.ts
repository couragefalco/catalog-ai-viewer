import {
  PAGE_INDEX_DIMS,
  encodePageIndex,
  poolPageVector,
  type PageEntry,
} from "@/lib/page-index";
import { getCatalog, getCatalogVectors, listCatalogs } from "@/lib/store";

// Baut den Seiten-Index scheibenweise aus den bereits gespeicherten
// Chunk-Vektoren (kein erneutes Embedding nötig): pro Seite das normierte
// Mittel ihrer Chunk-Vektoren, gekürzt auf PAGE_INDEX_DIMS.
// Der Aufrufer sammelt die Scheiben und schreibt den Index einmal.

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request) {
  const token = process.env.REEMBED_TOKEN;
  if (!token || req.headers.get("x-reembed-token") !== token) {
    return Response.json({ error: "Nicht autorisiert" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const offset = Math.max(0, Number(searchParams.get("offset") ?? "0") || 0);
  const limit = Math.min(
    120,
    Math.max(1, Number(searchParams.get("limit") ?? "40") || 40),
  );

  const metas = await listCatalogs();
  const slice = metas.slice(offset, offset + limit);

  const entries: PageEntry[] = [];
  const vectors: Float32Array[] = [];
  let missingVectors = 0;

  await Promise.all(
    slice.map(async (meta) => {
      const [record, chunkVectors] = await Promise.all([
        getCatalog(meta.id),
        getCatalogVectors(meta.id).catch(() => null),
      ]);
      if (!record) return;
      if (!chunkVectors || chunkVectors.length !== record.chunks.length) {
        missingVectors++;
        return;
      }
      const byPage = new Map<number, number[][]>();
      record.chunks.forEach((chunk, i) => {
        const list = byPage.get(chunk.page) ?? [];
        list.push(chunkVectors[i]);
        byPage.set(chunk.page, list);
      });
      for (const [page, pageVectors] of [...byPage.entries()].sort(
        (a, b) => a[0] - b[0],
      )) {
        entries.push({ c: record.id, p: page });
        vectors.push(poolPageVector(pageVectors, PAGE_INDEX_DIMS));
      }
    }),
  );

  const blob = encodePageIndex(entries, vectors, PAGE_INDEX_DIMS);
  const nextOffset =
    offset + slice.length < metas.length ? offset + slice.length : null;

  return Response.json({
    total: metas.length,
    offset,
    processed: slice.length,
    pages: entries.length,
    missingVectors,
    dims: PAGE_INDEX_DIMS,
    entries: blob.entries,
    b64: blob.b64,
    nextOffset,
  });
}
