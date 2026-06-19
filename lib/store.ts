import { put, get, list, del } from "@vercel/blob";
import type { CatalogMeta, CatalogRecord } from "./catalog";

const PREFIX = "catalogs/";
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

export async function listCatalogs(): Promise<CatalogMeta[]> {
  const { blobs } = await list({ prefix: PREFIX });
  const ids = blobs
    .map((b) => b.pathname)
    .filter((p) => p.endsWith(".json") && !p.endsWith(".vec.json"))
    .map((p) => p.slice(PREFIX.length, -".json".length));
  const records = await Promise.all(ids.map((id) => getCatalog(id)));
  return records
    .filter((r): r is CatalogRecord => r !== null)
    .map(({ chunks: _chunks, ...meta }) => meta)
    .sort((a, b) => a.name.localeCompare(b.name));
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
}

export async function patchCatalog(
  id: string,
  patch: Partial<Pick<CatalogMeta, "name" | "notes" | "exampleQuestions">>,
): Promise<CatalogRecord | null> {
  const current = await getCatalog(id);
  if (!current) return null;
  const next: CatalogRecord = { ...current, ...patch };
  await put(jsonKey(id), JSON.stringify(next), {
    access: "private",
    allowOverwrite: true,
    contentType: "application/json",
  });
  return next;
}

export async function removeCatalog(id: string): Promise<void> {
  await Promise.all([del(jsonKey(id)), del(pdfKey(id)), del(vecKey(id))]);
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
