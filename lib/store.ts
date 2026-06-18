import { put, get, list, del } from "@vercel/blob";
import type { CatalogMeta, CatalogRecord } from "./catalog";

const PREFIX = "catalogs/";
const jsonKey = (id: string) => `${PREFIX}${id}.json`;
const pdfKey = (id: string) => `${PREFIX}${id}.pdf`;
const ACCESS = { access: "private" as const };

export async function getCatalog(id: string): Promise<CatalogRecord | null> {
  const res = await get(jsonKey(id), ACCESS);
  if (!res || res.statusCode !== 200 || !res.stream) return null;
  return (await new Response(res.stream).json()) as CatalogRecord;
}

export async function listCatalogs(): Promise<CatalogMeta[]> {
  const { blobs } = await list({ prefix: PREFIX });
  const ids = blobs
    .map((b) => b.pathname)
    .filter((p) => p.endsWith(".json"))
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
    put(pdfKey(record.id), pdf, {
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
  await Promise.all([del(jsonKey(id)), del(pdfKey(id))]);
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
