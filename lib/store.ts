import { put, get, list, del } from "@vercel/blob";
import type { CatalogMeta, CatalogRecord } from "./catalog";

const PREFIX = "catalogs/";
// Der Index lebt bewusst AUSSERHALB von "catalogs/", damit ältere Deployments
// (die alle *.json unter dem Prefix als Kataloge interpretieren) ihn ignorieren.
const INDEX_KEY = "catalog-index/index.json";
const SUMMARY_VEC_KEY = "catalog-index/summary-vectors.json";
const jsonKey = (id: string) => `${PREFIX}${id}.json`;
const pdfKey = (id: string) => `${PREFIX}${id}.pdf`;
const vecKey = (id: string) => `${PREFIX}${id}.vec.json`;
const ACCESS = { access: "private" as const };

export async function getCatalog(id: string): Promise<CatalogRecord | null> {
  const res = await get(jsonKey(id), ACCESS);
  if (!res || res.statusCode !== 200 || !res.stream) return null;
  const record = (await new Response(res.stream).json()) as CatalogRecord;
  // Altdaten ohne mode-Feld auf "full" normalisieren
  return { ...record, mode: record.mode ?? "full" };
}

async function readJsonBlob<T>(pathname: string): Promise<T | null> {
  const res = await get(pathname, ACCESS);
  if (!res || res.statusCode !== 200 || !res.stream) return null;
  return (await new Response(res.stream).json()) as T;
}

async function writeJsonBlob(pathname: string, value: unknown): Promise<void> {
  await put(pathname, JSON.stringify(value), {
    access: "private",
    allowOverwrite: true,
    contentType: "application/json",
  });
}

const sortMetas = (metas: CatalogMeta[]) =>
  [...metas].sort((a, b) => a.name.localeCompare(b.name));

// Vollscan über alle Katalog-JSONs. Teuer (ein GET pro Katalog) - nur als
// Fallback ohne Index und für explizite Rebuilds (Bulk-Import) verwenden.
export async function rebuildCatalogIndex(): Promise<CatalogMeta[]> {
  const ids: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix: PREFIX, cursor });
    ids.push(
      ...page.blobs
        .map((b) => b.pathname)
        .filter((p) => p.endsWith(".json") && !p.endsWith(".vec.json"))
        .map((p) => p.slice(PREFIX.length, -".json".length)),
    );
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);

  const records: (CatalogRecord | null)[] = [];
  const BATCH = 40;
  for (let i = 0; i < ids.length; i += BATCH) {
    records.push(
      ...(await Promise.all(ids.slice(i, i + BATCH).map((id) => getCatalog(id)))),
    );
  }
  const metas = sortMetas(
    records
      .filter((r): r is CatalogRecord => r !== null)
      .map(({ chunks: _chunks, ...meta }) => meta),
  );
  await writeJsonBlob(INDEX_KEY, metas);
  return metas;
}

export async function listCatalogs(): Promise<CatalogMeta[]> {
  const indexed = await readJsonBlob<CatalogMeta[]>(INDEX_KEY);
  if (Array.isArray(indexed)) return sortMetas(indexed);
  return rebuildCatalogIndex();
}

async function upsertIndexEntry(meta: CatalogMeta): Promise<void> {
  const metas = await listCatalogs();
  const next = sortMetas([...metas.filter((m) => m.id !== meta.id), meta]);
  await writeJsonBlob(INDEX_KEY, next);
}

async function removeIndexEntry(id: string): Promise<void> {
  const metas = await readJsonBlob<CatalogMeta[]>(INDEX_KEY);
  if (!Array.isArray(metas)) return;
  await writeJsonBlob(
    INDEX_KEY,
    metas.filter((m) => m.id !== id),
  );
}

export async function getCatalogPdfStream(
  id: string,
): Promise<ReadableStream<Uint8Array> | null> {
  const res = await get(pdfKey(id), ACCESS);
  if (!res || res.statusCode !== 200 || !res.stream) return null;
  return res.stream;
}

export async function getCatalogPdfBytes(
  id: string,
): Promise<Uint8Array | null> {
  const stream = await getCatalogPdfStream(id);
  if (!stream) return null;
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function saveCatalog(
  record: CatalogRecord,
  pdf: Uint8Array,
  options?: { updateIndex?: boolean }, // Bulk-Importe rebuilden den Index am Ende selbst
): Promise<void> {
  await Promise.all([
    put(jsonKey(record.id), JSON.stringify(record), {
      access: "private",
      allowOverwrite: true,
      contentType: "application/json",
    }),
    put(pdfKey(record.id), Buffer.from(pdf), {
      access: "private",
      allowOverwrite: true,
      contentType: "application/pdf",
    }),
  ]);
  if (options?.updateIndex !== false) {
    const { chunks: _chunks, ...meta } = record;
    await upsertIndexEntry(meta);
  }
}

export async function patchCatalog(
  id: string,
  patch: Partial<
    Pick<CatalogMeta, "name" | "notes" | "exampleQuestions" | "category">
  >,
): Promise<CatalogRecord | null> {
  const current = await getCatalog(id);
  if (!current) return null;
  const next: CatalogRecord = { ...current, ...patch };
  await put(jsonKey(id), JSON.stringify(next), {
    access: "private",
    allowOverwrite: true,
    contentType: "application/json",
  });
  const { chunks: _chunks, ...meta } = next;
  await upsertIndexEntry(meta);
  return next;
}

export async function removeCatalog(id: string): Promise<void> {
  await Promise.all([del(jsonKey(id)), del(pdfKey(id)), del(vecKey(id))]);
  await Promise.all([removeIndexEntry(id), removeSummaryVector(id)]);
}

// --- Katalogweite Zusammenfassungs-Vektoren -------------------------------
// Ein Vektor pro Katalog (Name + Notizen + Textprobe), gebündelt in einem
// einzigen Blob. Der globale Chat nutzt sie als Vorfilter, damit nicht mehr
// jeder Katalog pro Frage geladen werden muss.

export type SummaryVectors = Record<string, number[]>;

export async function getSummaryVectors(): Promise<SummaryVectors | null> {
  return readJsonBlob<SummaryVectors>(SUMMARY_VEC_KEY);
}

export async function saveSummaryVectors(
  vectors: SummaryVectors,
): Promise<void> {
  await writeJsonBlob(SUMMARY_VEC_KEY, vectors);
}

export async function upsertSummaryVector(
  id: string,
  vector: number[],
): Promise<void> {
  const vectors = (await getSummaryVectors()) ?? {};
  vectors[id] = vector;
  await saveSummaryVectors(vectors);
}

async function removeSummaryVector(id: string): Promise<void> {
  const vectors = await getSummaryVectors();
  if (!vectors || !(id in vectors)) return;
  delete vectors[id];
  await saveSummaryVectors(vectors);
}

export async function saveCatalogVectors(
  id: string,
  vectors: number[][],
): Promise<void> {
  await put(vecKey(id), JSON.stringify(vectors), {
    access: "private",
    allowOverwrite: true,
    contentType: "application/json",
  });
}

export async function getCatalogVectors(
  id: string,
): Promise<number[][] | null> {
  const res = await get(vecKey(id), ACCESS);
  if (!res || res.statusCode !== 200 || !res.stream) return null;
  return (await new Response(res.stream).json()) as number[][];
}

export async function getBlobBytes(
  pathname: string,
): Promise<Uint8Array | null> {
  const res = await get(pathname, ACCESS);
  if (!res || res.statusCode !== 200 || !res.stream) return null;
  return new Uint8Array(await new Response(res.stream).arrayBuffer());
}

export async function removeBlob(pathname: string): Promise<void> {
  await del(pathname);
}

async function idExists(id: string): Promise<boolean> {
  return (await get(jsonKey(id), ACCESS)) !== null;
}

export async function uniqueId(base: string): Promise<string> {
  if (!(await idExists(base))) return base;
  let n = 2;
  while (await idExists(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}
