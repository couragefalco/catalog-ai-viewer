import { describe, it, expect, vi, beforeEach } from "vitest";

const mem = new Map<string, string | Uint8Array>();

vi.mock("@vercel/blob", () => ({
  put: vi.fn(async (pathname: string, body: any) => {
    mem.set(
      pathname,
      typeof body === "string" ? body : new Uint8Array(body),
    );
    return { pathname, url: `https://blob.test/${pathname}` };
  }),
  get: vi.fn(async (pathname: string) => {
    if (!mem.has(pathname)) return null;
    const body = mem.get(pathname)!;
    return {
      statusCode: 200,
      stream: new Response(body as BodyInit).body,
      blob: { pathname, contentType: "application/octet-stream" },
    };
  }),
  list: vi.fn(async ({ prefix }: { prefix: string }) => ({
    blobs: [...mem.keys()]
      .filter((k) => k.startsWith(prefix))
      .map((pathname) => ({ pathname, url: `https://blob.test/${pathname}` })),
  })),
  del: vi.fn(async (pathname: string) => {
    mem.delete(pathname);
  }),
}));

import {
  saveCatalog,
  getCatalog,
  listCatalogs,
  patchCatalog,
  removeCatalog,
  uniqueId,
  getCatalogPdfStream,
  saveCatalogVectors,
  getCatalogVectors,
} from "../lib/store";
import type { CatalogRecord } from "../lib/catalog";

const record = (id: string): CatalogRecord => ({
  id,
  name: "Test Katalog",
  numPages: 2,
  notes: "",
  exampleQuestions: [],
  createdAt: "2026-06-18T00:00:00.000Z",
  mode: "full",
  chunks: [{ id: "p1-b0", page: 1, bbox: { x: 0, y: 0, w: 1, h: 1 }, text: "hallo welt" }],
});

beforeEach(() => mem.clear());

describe("store", () => {
  it("saves and reads a catalog record", async () => {
    await saveCatalog(record("a1"), new Uint8Array([1, 2, 3]));
    const got = await getCatalog("a1");
    expect(got?.name).toBe("Test Katalog");
    expect(got?.chunks).toHaveLength(1);
  });

  it("lists metadata without chunks", async () => {
    await saveCatalog(record("a1"), new Uint8Array([1]));
    const list = await listCatalogs();
    expect(list).toHaveLength(1);
    expect((list[0] as any).chunks).toBeUndefined();
    expect(list[0].id).toBe("a1");
  });

  it("patches notes without touching chunks", async () => {
    await saveCatalog(record("a1"), new Uint8Array([1]));
    const updated = await patchCatalog("a1", { notes: "achtung e-Ketten" });
    expect(updated?.notes).toBe("achtung e-Ketten");
    expect(updated?.chunks).toHaveLength(1);
  });

  it("removes a catalog", async () => {
    await saveCatalog(record("a1"), new Uint8Array([1]));
    await removeCatalog("a1");
    expect(await getCatalog("a1")).toBeNull();
  });

  it("uniqueId avoids collisions", async () => {
    await saveCatalog(record("kat"), new Uint8Array([1]));
    expect(await uniqueId("kat")).toBe("kat-2");
  });

  it("returns a readable pdf stream after save", async () => {
    await saveCatalog(record("a1"), new Uint8Array([9, 8, 7]));
    const stream = await getCatalogPdfStream("a1");
    expect(stream).not.toBeNull();
    const bytes = new Uint8Array(await new Response(stream!).arrayBuffer());
    expect([...bytes]).toEqual([9, 8, 7]);
  });

  it("vector round-trip: saveCatalogVectors + getCatalogVectors", async () => {
    const vecs = [[1, 0, 0], [0, 1, 0]];
    await saveCatalogVectors("v1", vecs);
    const got = await getCatalogVectors("v1");
    expect(got).toEqual(vecs);
  });

  it("getCatalogVectors returns null for missing id", async () => {
    expect(await getCatalogVectors("nonexistent")).toBeNull();
  });

  it("getCatalog normalizes missing mode to 'full'", async () => {
    // Altdatensatz ohne mode-Feld direkt in den Speicher schreiben
    const legacyRecord = {
      id: "legacy",
      name: "Altdaten",
      numPages: 5,
      notes: "",
      exampleQuestions: [],
      createdAt: "2025-01-01T00:00:00.000Z",
      chunks: [],
    };
    mem.set("catalogs/legacy.json", JSON.stringify(legacyRecord));
    const got = await getCatalog("legacy");
    expect(got?.mode).toBe("full");
  });

  it("listCatalogs ignores vector blobs", async () => {
    await saveCatalog(record("a1"), new Uint8Array([1]));
    await saveCatalogVectors("a1", [[0.1, 0.2]]);
    const list = await listCatalogs();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe("a1");
  });
});
