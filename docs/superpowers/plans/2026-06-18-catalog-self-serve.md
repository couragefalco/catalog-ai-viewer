# Catalog Self-Serve Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let non-developers upload a catalog PDF in the browser and have it go live immediately at its own URL, with a password-gated admin area for managing catalogs and per-document retrieval context.

**Architecture:** Replace the build-time generated TypeScript catalog modules with a runtime data layer backed by a private Vercel Blob store. Each catalog is one PDF blob plus one JSON blob (metadata + citation chunks); the catalog list is derived from `list()`, not a mutable index. The MuPDF text/bbox extraction moves out of the offline script into a shared module called by a new upload route. Private PDFs reach the browser through a server streaming route.

**Tech Stack:** Next.js 16.2.7 (App Router), React 19.2, Vercel AI SDK v6 (`ai`, `@ai-sdk/google`), Gemini 2.5 Flash, `mupdf` 1.27 (WASM), `@vercel/blob`, Vitest, Node `crypto`.

## Global Constraints

- This is a **modified Next.js**: before using any unfamiliar App Router / route / config API, read the matching guide under `node_modules/next/dist/docs/`. Do not assume from memory.
- App Router only. Route handlers and server components run in the Node.js runtime (needed for `mupdf` and `node:crypto`). Do **not** set `export const runtime = 'edge'` on any route in this plan.
- Never use em dashes in code comments or UI copy. UI copy is **German** (match existing tone in `components/chat-panel.tsx`).
- Blob store: `catalog-ai-viewer-blob` = `store_NnU2oYebKkBF6moT`, **private**, region `iad1`. All blob calls pass `access: 'private'`. Token from `process.env.BLOB_READ_WRITE_TOKEN`.
- Blob keys are **deterministic**: `catalogs/<id>.json` and `catalogs/<id>.pdf`. Always pass `allowOverwrite: true` on `put` (no `addRandomSuffix`). **No `index.json`** — derive the catalog list from `list({ prefix: 'catalogs/' })`.
- `BASE_PATH` comes from `NEXT_PUBLIC_BASE_PATH` (`/catalog` in production behind the igus proxy). Keep using `@/lib/base-path` for client-built URLs.
- Model id stays `gemini-2.5-flash` via `google(...)` from `@ai-sdk/google`.
- Frequent commits: one commit per task minimum.
- **Branding:** a small igus logo sits top-left in the catalog toolbar, the landing header, and the admin header. Asset at `public/igus-logo.svg` (provided by the operator). Render at ~20px tall via `<img>` with `src={`${BASE_PATH}/igus-logo.svg`}` and `alt="igus"`; if the asset is missing the `alt` text shows. Do not recreate the trademark in code. See Task 10.

---

## File Structure

**New files**
- `lib/catalog.ts` — shared catalog/chunk types (replaces types from generated modules).
- `lib/ingest.ts` — `ingestPdf(bytes)` + `slugify`, extracted from `scripts/ingest.mjs`.
- `lib/store.ts` — Blob-backed CRUD for catalogs.
- `lib/admin-auth.ts` — password check + signed session cookie helpers.
- `app/api/catalog/[id]/pdf/route.ts` — streams a private PDF blob to the browser.
- `app/api/admin/login/route.ts` — verifies password, sets session cookie.
- `app/api/admin/catalogs/route.ts` — `POST` upload (multipart) → ingest → enrich → save.
- `app/api/admin/catalogs/[id]/route.ts` — `PATCH` notes/name/questions, `DELETE` catalog.
- `app/catalog/[id]/page.tsx` — single-catalog server page.
- `components/catalog-workspace.tsx` — client split-view wrapper (viewer + chat) for one catalog.
- `app/admin/page.tsx` + `components/admin-dashboard.tsx` — admin UI.
- `lib/enrich.ts` — one Gemini call drafting name/notes/example questions.
- `test/fixtures/sample.pdf` — small real PDF fixture for ingest tests.
- Vitest unit tests alongside the above under `test/`.

**Modified files**
- `next.config.ts` — add `serverExternalPackages: ['mupdf']`.
- `package.json` — add deps + `test` script.
- `.env.example` / `.env.local` — new env vars.
- `app/api/chat/route.ts` — read catalog + PDF from Blob; inject `notes`.
- `app/page.tsx` — becomes a landing/list (no hardcoded generated import).
- `components/catalog-viewer.tsx` — make the catalog selector sidebar optional.
- `scripts/ingest.mjs` — rewrite as an optional Blob bulk-importer (Task 9) reusing `lib/ingest.ts`.

**Removed at the end (Task 9)**
- `lib/catalogs.ts` / `lib/catalogs.example.ts`, `lib/chunks-data.ts` / `lib/chunks-data.example.ts`, `scripts/ensure-data.mjs`, the `predev`/`prebuild` hooks and `public/catalogs/` usage.

---

## Task 1: Tooling and config foundation

**Files:**
- Modify: `package.json` (deps + scripts)
- Modify: `next.config.ts`
- Modify: `.env.example`, `.env.local`
- Create: `vitest.config.ts`

**Interfaces:**
- Produces: `npm test` runs Vitest in Node; `@vercel/blob` and `vitest` installed; `mupdf` marked as a server-external package so Next does not try to bundle the WASM.

- [ ] **Step 1: Install dependencies**

Run:
```bash
npm install @vercel/blob
npm install -D vitest
```

- [ ] **Step 2: Add the test script**

In `package.json` `scripts`, add:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 3: Mark mupdf as server-external in `next.config.ts`**

Replace the file with:
```ts
import type { NextConfig } from "next";

// Optionally serve the app under a sub-path (e.g. "/catalog") when it sits
// behind a reverse proxy. Set NEXT_PUBLIC_BASE_PATH to enable; defaults to root.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || undefined;

const nextConfig: NextConfig = {
  ...(basePath ? { basePath } : {}),
  // mupdf ships a large WASM binary; keep it out of the bundler so it loads
  // natively in the Node.js runtime of our route handlers.
  serverExternalPackages: ["mupdf"],
};

export default nextConfig;
```

Before editing, confirm the option name for this Next version:
```bash
grep -rl "serverExternalPackages" node_modules/next/dist/docs/ | head
```
If the docs name it differently for 16.2.7, use the documented key. Expected: `serverExternalPackages` is correct for Next 15+/16.

- [ ] **Step 4: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
```

- [ ] **Step 5: Add env vars**

Append to `.env.example`:
```bash
# Vercel Blob (private store catalog-ai-viewer-blob / store_NnU2oYebKkBF6moT)
BLOB_READ_WRITE_TOKEN=
# Admin area
ADMIN_PASSWORD=
ADMIN_SECRET=
```
Add real values to `.env.local`. Get the Blob token with:
```bash
vercel blob get-store store_NnU2oYebKkBF6moT
```
If the token is not printed, create one in the Vercel dashboard (Storage → catalog-ai-viewer-blob → tokens) or run `vercel env pull` after linking the project. Set `ADMIN_PASSWORD` to any chosen password and `ADMIN_SECRET` to a long random string (`openssl rand -hex 32`).

- [ ] **Step 6: Verify the toolchain**

Run:
```bash
npx vitest run --reporter=basic 2>&1 | tail -5
```
Expected: Vitest runs and reports "No test files found" (no tests yet). That confirms Vitest is installed and configured.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json next.config.ts vitest.config.ts .env.example
git commit -m "chore: add blob/vitest deps, mupdf server-external, admin env"
```

---

## Task 2: Shared types and ingest module (validates MuPDF risk)

This task extracts the MuPDF extraction into a typed module and proves it runs inside a Next route — the spec's "validate first" step.

**Files:**
- Create: `lib/catalog.ts`
- Create: `lib/ingest.ts`
- Create: `test/fixtures/sample.pdf`
- Create: `test/ingest.test.ts`
- Create (temporary, deleted in Step 7): `app/api/_spike/route.ts`

**Interfaces:**
- Produces:
  - `lib/catalog.ts`: `type Bbox = { x: number; y: number; w: number; h: number }`; `type Chunk = { id: string; page: number; bbox: Bbox; text: string }`; `type CatalogMeta = { id: string; name: string; numPages: number; notes: string; exampleQuestions: string[]; createdAt: string }`; `type CatalogRecord = CatalogMeta & { chunks: Chunk[] }`.
  - `lib/ingest.ts`: `function slugify(name: string): string`; `function ingestPdf(bytes: Uint8Array): { numPages: number; chunks: Chunk[] }`.

- [ ] **Step 1: Create the shared types `lib/catalog.ts`**

```ts
// Shared catalog + citation-chunk types. The runtime source of truth lives in
// Vercel Blob (see lib/store.ts); these types describe the JSON record shape.
export type Bbox = { x: number; y: number; w: number; h: number };

export type Chunk = {
  id: string; // e.g. "p3-b5" (page 3, block 5)
  page: number;
  bbox: Bbox; // normalized 0..1, used to draw citation highlights
  text: string;
};

export type CatalogMeta = {
  id: string;
  name: string;
  numPages: number;
  notes: string; // human/AI retrieval hints injected into the chat prompt
  exampleQuestions: string[];
  createdAt: string; // ISO timestamp
};

export type CatalogRecord = CatalogMeta & { chunks: Chunk[] };
```

- [ ] **Step 2: Add a fixture PDF**

Place any small real PDF (1 to 3 pages, with selectable text) at `test/fixtures/sample.pdf`. A one-page PDF is enough. If you have none handy:
```bash
mkdir -p test/fixtures
# Use any PDF on the machine, e.g. a macOS sample, then verify it is a PDF:
cp "$(mdfind -name .pdf 'kMDItemContentType == com.adobe.pdf' 2>/dev/null | head -1)" test/fixtures/sample.pdf 2>/dev/null || true
file test/fixtures/sample.pdf
```
Expected: `test/fixtures/sample.pdf: PDF document...`. If empty, copy any PDF manually.

- [ ] **Step 3: Write the failing test `test/ingest.test.ts`**

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { ingestPdf, slugify } from "../lib/ingest";

describe("slugify", () => {
  it("lowercases and dashes", () => {
    expect(slugify("DE_Factsheet PRT-01_print.pdf")).toBe(
      "de-factsheet-prt-01-print",
    );
  });
});

describe("ingestPdf", () => {
  const bytes = new Uint8Array(
    readFileSync(join(__dirname, "fixtures/sample.pdf")),
  );

  it("returns page count and chunk array", () => {
    const result = ingestPdf(bytes);
    expect(result.numPages).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(result.chunks)).toBe(true);
    for (const c of result.chunks) {
      expect(c.id).toMatch(/^p\d+-b\d+$/);
      expect(c.page).toBeGreaterThanOrEqual(1);
      expect(c.bbox.x).toBeGreaterThanOrEqual(0);
      expect(c.bbox.x).toBeLessThanOrEqual(1);
    }
  });
});
```

- [ ] **Step 4: Run it, verify it fails**

Run: `npx vitest run test/ingest.test.ts`
Expected: FAIL — cannot find module `../lib/ingest`.

- [ ] **Step 5: Implement `lib/ingest.ts`**

Port the logic from `scripts/ingest.mjs:22-107` verbatim into typed TS:
```ts
import * as mupdf from "mupdf";
import type { Chunk } from "./catalog";

const clamp = (v: number) => Math.max(0, Math.min(1, v));

const clean = (s: string) =>
  Array.from(s)
    .map((ch) => {
      const c = ch.codePointAt(0) ?? 0;
      if (c === 0xfffd || c < 0x20 || (c >= 0x7f && c <= 0x9f)) return " ";
      return ch;
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim();

export const slugify = (name: string): string =>
  name
    .replace(/\.pdf$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

// Extract page text as positioned blocks. One chunk per text block, with a
// normalized bbox so the viewer can draw a citation highlight. Mirrors the
// original offline ingest so existing chunk ids stay stable.
export function ingestPdf(bytes: Uint8Array): {
  numPages: number;
  chunks: Chunk[];
} {
  const doc = mupdf.Document.openDocument(bytes, "application/pdf");
  const numPages = doc.countPages();
  const chunks: Chunk[] = [];

  for (let i = 0; i < numPages; i++) {
    const page = doc.loadPage(i);
    const [x0, y0, x1, y1] = page.getBounds();
    const W = x1 - x0;
    const H = y1 - y0;
    const json = JSON.parse(
      page.toStructuredText("preserve-whitespace").asJSON(),
    );
    (json.blocks || []).forEach(
      (block: any, bIdx: number) => {
        if (block.type !== "text" || !block.lines?.length) return;
        const text = clean(
          block.lines.map((l: any) => l.text || "").join(" "),
        );
        if (text.length < 10) return;
        const b = block.bbox;
        chunks.push({
          id: `p${i + 1}-b${bIdx}`,
          page: i + 1,
          bbox: {
            x: clamp((b.x - x0) / W),
            y: clamp((b.y - y0) / H),
            w: clamp(b.w / W),
            h: clamp(b.h / H),
          },
          text,
        });
      },
    );
  }

  return { numPages, chunks };
}
```

- [ ] **Step 6: Run the test, verify it passes**

Run: `npx vitest run test/ingest.test.ts`
Expected: PASS (both describe blocks green).

- [ ] **Step 7: Validate MuPDF inside a real Next route, then remove the spike**

Create `app/api/_spike/route.ts`:
```ts
import { ingestPdf } from "@/lib/ingest";

export async function POST(req: Request) {
  const buf = new Uint8Array(await req.arrayBuffer());
  const { numPages, chunks } = ingestPdf(buf);
  return Response.json({ numPages, chunkCount: chunks.length });
}
```
Run the app and post the fixture:
```bash
npm run dev   # in one shell
# in another:
curl -s -X POST --data-binary @test/fixtures/sample.pdf \
  -H "Content-Type: application/pdf" http://localhost:3000/api/_spike
```
Expected: JSON like `{"numPages":1,"chunkCount":N}` with HTTP 200 — this proves `mupdf` loads and runs inside a Next route handler (the spec's first-risk validation). If it fails to bundle, fix `serverExternalPackages` before continuing.
Then delete the spike: `rm -r app/api/_spike`.

- [ ] **Step 8: Commit**

```bash
git add lib/catalog.ts lib/ingest.ts test/ingest.test.ts test/fixtures/sample.pdf
git commit -m "feat: shared ingest module + types; validate mupdf in route"
```

---

## Task 3: Blob-backed catalog store

**Files:**
- Create: `lib/store.ts`
- Create: `test/store.test.ts`

**Interfaces:**
- Consumes: `CatalogRecord`, `CatalogMeta` from `lib/catalog.ts`.
- Produces (all async):
  - `getCatalog(id: string): Promise<CatalogRecord | null>`
  - `listCatalogs(): Promise<CatalogMeta[]>` (metadata only, no `chunks`)
  - `getCatalogPdfStream(id: string): Promise<ReadableStream<Uint8Array> | null>`
  - `getCatalogPdfBytes(id: string): Promise<Uint8Array | null>`
  - `saveCatalog(record: CatalogRecord, pdf: Uint8Array): Promise<void>`
  - `patchCatalog(id: string, patch: Partial<Pick<CatalogMeta, "name" | "notes" | "exampleQuestions">>): Promise<CatalogRecord | null>`
  - `removeCatalog(id: string): Promise<void>`
  - `uniqueId(base: string): Promise<string>`

- [ ] **Step 1: Write the failing test `test/store.test.ts`**

Mock `@vercel/blob` with an in-memory map so the store logic is tested without network:
```ts
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
      stream: new Response(body).body,
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
} from "../lib/store";
import type { CatalogRecord } from "../lib/catalog";

const record = (id: string): CatalogRecord => ({
  id,
  name: "Test Katalog",
  numPages: 2,
  notes: "",
  exampleQuestions: [],
  createdAt: "2026-06-18T00:00:00.000Z",
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
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run test/store.test.ts`
Expected: FAIL — cannot find `../lib/store`.

- [ ] **Step 3: Implement `lib/store.ts`**

```ts
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
  if (!res || res.statusCode !== 200) return null;
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
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `npx vitest run test/store.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/store.ts test/store.test.ts
git commit -m "feat: blob-backed catalog store with derived listing"
```

---

## Task 4: Admin auth (password + signed cookie)

**Files:**
- Create: `lib/admin-auth.ts`
- Create: `test/admin-auth.test.ts`
- Create: `app/api/admin/login/route.ts`

**Interfaces:**
- Produces:
  - `COOKIE_NAME = "cat_admin"`
  - `checkPassword(input: string): boolean`
  - `signSession(): string`
  - `isValidSession(token: string | undefined): boolean`
  - `requireAdmin(): Promise<boolean>` (reads the cookie via `next/headers`)

- [ ] **Step 1: Write the failing test `test/admin-auth.test.ts`**

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { signSession, isValidSession, checkPassword } from "../lib/admin-auth";

beforeAll(() => {
  process.env.ADMIN_SECRET = "test-secret";
  process.env.ADMIN_PASSWORD = "hunter2";
});

describe("admin-auth", () => {
  it("accepts a self-signed session", () => {
    expect(isValidSession(signSession())).toBe(true);
  });
  it("rejects a tampered token", () => {
    expect(isValidSession(signSession() + "x")).toBe(false);
  });
  it("rejects undefined", () => {
    expect(isValidSession(undefined)).toBe(false);
  });
  it("checks the password", () => {
    expect(checkPassword("hunter2")).toBe(true);
    expect(checkPassword("wrong")).toBe(false);
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run test/admin-auth.test.ts`
Expected: FAIL — cannot find `../lib/admin-auth`.

- [ ] **Step 3: Implement `lib/admin-auth.ts`**

```ts
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

export const COOKIE_NAME = "cat_admin";
const PAYLOAD = "admin";

function hmac(value: string): string {
  const secret = process.env.ADMIN_SECRET ?? "";
  return createHmac("sha256", secret).update(value).digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function checkPassword(input: string): boolean {
  const expected = process.env.ADMIN_PASSWORD ?? "";
  if (!expected) return false;
  return safeEqual(input, expected);
}

export function signSession(): string {
  return `${PAYLOAD}.${hmac(PAYLOAD)}`;
}

export function isValidSession(token: string | undefined): boolean {
  if (!token) return false;
  const [payload, sig] = token.split(".");
  if (payload !== PAYLOAD || !sig) return false;
  return safeEqual(sig, hmac(PAYLOAD));
}

export async function requireAdmin(): Promise<boolean> {
  const store = await cookies();
  return isValidSession(store.get(COOKIE_NAME)?.value);
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `npx vitest run test/admin-auth.test.ts`
Expected: PASS (4 tests). Note: `requireAdmin` is not unit-tested here (it needs the Next request scope); it is exercised manually in Task 7.

- [ ] **Step 5: Implement the login route `app/api/admin/login/route.ts`**

```ts
import { cookies } from "next/headers";
import { checkPassword, signSession, COOKIE_NAME } from "@/lib/admin-auth";

export async function POST(req: Request) {
  const { password } = (await req.json()) as { password?: string };
  if (!password || !checkPassword(password)) {
    return Response.json({ ok: false }, { status: 401 });
  }
  const store = await cookies();
  store.set(COOKIE_NAME, signSession(), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 12, // 12h
  });
  return Response.json({ ok: true });
}
```

- [ ] **Step 6: Commit**

```bash
git add lib/admin-auth.ts test/admin-auth.test.ts app/api/admin/login/route.ts
git commit -m "feat: admin password auth with signed session cookie"
```

---

## Task 5: Serve private PDFs and migrate chat to Blob

**Files:**
- Create: `app/api/catalog/[id]/pdf/route.ts`
- Modify: `app/api/chat/route.ts`

**Interfaces:**
- Consumes: `getCatalog`, `getCatalogPdfStream`, `getCatalogPdfBytes` from `lib/store.ts`.
- Produces: `GET /api/catalog/<id>/pdf` streams the PDF; `POST /api/chat` reads catalog data from Blob and injects `notes`.

- [ ] **Step 1: Implement the PDF streaming route `app/api/catalog/[id]/pdf/route.ts`**

Note: in this Next version route context `params` is async. Confirm with `grep -rn "params" node_modules/next/dist/docs/ | grep -i route | head` if unsure.
```ts
import { getCatalogPdfStream } from "@/lib/store";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const stream = await getCatalogPdfStream(id);
  if (!stream) return new Response("Not found", { status: 404 });
  return new Response(stream, {
    headers: {
      "Content-Type": "application/pdf",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=300",
    },
  });
}
```

- [ ] **Step 2: Migrate `app/api/chat/route.ts` to Blob + notes**

Replace lines 1-51 (imports through the `system` prompt) so it reads from the store instead of the generated modules, and injects `notes`. Keep the streaming/citation logic (lines 53-136) unchanged.

New top of file:
```ts
import { google } from "@ai-sdk/google";
import { streamText, type ModelMessage } from "ai";
import { getCatalog, getCatalogPdfBytes } from "@/lib/store";
import { resolveCatalogChunk } from "@/lib/store-chunks";
import type { Citation } from "@/lib/types";

export const maxDuration = 60;

type InMsg = { role: "user" | "assistant"; text: string };

export async function POST(req: Request) {
  const { messages, docId }: { messages: InMsg[]; docId: string } =
    await req.json();

  const catalog = await getCatalog(docId);
  if (!catalog) {
    return Response.json({ text: "Unbekanntes Dokument.", citations: [] });
  }
  const chunks = catalog.chunks;

  // Read the full PDF from Blob so Gemini reads it natively (incl. tables).
  const pdfBytes = await getCatalogPdfBytes(docId);

  const candidates = chunks
    .map((c) => `[${c.id}] (Seite ${c.page}) ${c.text}`)
    .join("\n");

  const notesBlock = catalog.notes?.trim()
    ? `\n\nZUSÄTZLICHER KONTEXT (vom Betreiber gepflegt, beachte ihn):\n${catalog.notes.trim()}\n`
    : "";

  const system = `Du bist ein Assistent für genau ein PDF: "${catalog.name}".
Das vollständige PDF ist angehängt — lies es direkt und vollständig, inklusive Tabellen, Maße und Spalten. Gib Tabellen bei Bedarf als Markdown-Tabelle aus.
Antworte auf Deutsch, präzise. Wenn etwas nicht im Dokument steht, sage das ehrlich.${notesBlock}

ZITATE:
- Setze hinter jede Aussage einen Marker im Format [[chunk-id]] (genau EINE id pro Klammerpaar).
- Mehrere Quellen: mehrere Marker direkt hintereinander, z. B. [[p5-b1]][[p5-b3]]. Fasse NIEMALS mehrere ids in ein Klammerpaar zusammen (kein [[p5-b1, p5-b3]]).
- Verwende AUSSCHLIESSLICH chunk-ids aus der folgenden Liste. Erfinde keine. Wähle den Chunk, dessen Seite/Inhalt am besten zu deiner Aussage passt.

=== ZITIER-KANDIDATEN ===
${candidates}
=== ENDE ===`;
```

Then in the citation resolver (around old line 89), replace `resolveChunk(docId, id)` with a lookup against the already-loaded `chunks` (no second fetch):
```ts
  const byId = new Map(chunks.map((c) => [c.id, c]));
  const allowed = new Set(chunks.map((c) => c.id));
  const buildCitations = (text: string): Citation[] => {
    const blocks = text.match(/\[\[[\s\S]*?\]\]/g) ?? [];
    const citedIds = [
      ...new Set(
        blocks
          .flatMap((b) => b.match(/p\d+-b\d+/g) ?? [])
          .filter((id) => allowed.has(id)),
      ),
    ].slice(0, 12);
    return citedIds
      .map((id) => {
        const chunk = byId.get(id);
        return chunk
          ? { id, page: chunk.page, bbox: chunk.bbox, snippet: chunk.text.slice(0, 160) }
          : null;
      })
      .filter(Boolean) as Citation[];
  };
```
Remove the now-unused imports of `CATALOGS`, `CHUNKS_BY_DOC`, `resolveChunk`, `BASE_PATH`, and the `resolveCatalogChunk`/`store-chunks` import shown above (it was a stray — delete that import line; the `byId` map replaces it). Keep `import type { Citation } from "@/lib/types"`.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors from `app/api/chat/route.ts` or the new PDF route. (Other files still importing the generated modules are fine until Task 6/9.)

- [ ] **Step 4: Manual smoke test**

With a catalog present (or after Task 7 upload), `npm run dev` then:
```bash
curl -s -o /tmp/c.pdf -w "%{http_code} %{content_type}\n" http://localhost:3000/api/catalog/<id>/pdf
```
Expected: `200 application/pdf` and `/tmp/c.pdf` is a valid PDF (`file /tmp/c.pdf`). If no catalog exists yet, defer this check to Task 7.

- [ ] **Step 5: Commit**

```bash
git add app/api/catalog app/api/chat/route.ts
git commit -m "feat: stream private PDFs; chat reads catalog from blob + notes"
```

---

## Task 6: Per-catalog route, landing page, optional selector

**Files:**
- Modify: `components/catalog-viewer.tsx` (make selector optional; PDF URL via route)
- Create: `components/catalog-workspace.tsx`
- Create: `app/catalog/[id]/page.tsx`
- Modify: `app/page.tsx` (landing list)

**Interfaces:**
- Consumes: `listCatalogs`, `getCatalog` from `lib/store.ts`; `CatalogMeta` from `lib/catalog.ts`.
- Produces:
  - A client `ClientCatalog = { id: string; name: string; numPages: number; file: string }` where `file = api/catalog/<id>/pdf` (BASE_PATH is prepended by the viewer).
  - `CatalogWorkspace({ catalog }: { catalog: ClientCatalog })` — the split view for one catalog.

- [ ] **Step 1: Make the selector sidebar optional in `components/catalog-viewer.tsx`**

Change the import on line 16 from the generated module to the shared client type. Replace line 16:
```ts
// before: import type { Catalog } from "@/lib/catalogs";
export type Catalog = { id: string; name: string; numPages: number; file: string };
```
Change the props type (lines 53-60) to make catalog-switching optional:
```ts
type CatalogViewerProps = {
  catalog: Catalog;
  catalogs?: Catalog[];
  onSelectCatalog?: (id: string) => void;
  page: number;
  onPageChange: (page: number) => void;
  activeCitation: Citation | null;
};
```
Guard the sidebar so it only renders when more than one catalog is provided. Wrap the `<Sidebar>...</Sidebar>` block (lines 96-142) in:
```tsx
{catalogs && catalogs.length > 1 && onSelectCatalog && (
  <Sidebar collapsible="offcanvas">
    {/* ...unchanged sidebar contents... */}
  </Sidebar>
)}
```
And only render `<SidebarTrigger className="-ml-1" />` (line 148) when the sidebar exists:
```tsx
{catalogs && catalogs.length > 1 && onSelectCatalog && (
  <SidebarTrigger className="-ml-1" />
)}
```
`fileUrl` on line 76 already resolves to `${BASE_PATH}/${catalog.file}`; since `file` will be `api/catalog/<id>/pdf`, no change needed there.

- [ ] **Step 2: Create the client workspace `components/catalog-workspace.tsx`**

This is the single-catalog version of the current `app/page.tsx`:
```tsx
"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { ChatPanel } from "@/components/chat-panel";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import type { Catalog } from "@/components/catalog-viewer";
import type { Citation } from "@/lib/types";

const CatalogViewer = dynamic(
  () => import("@/components/catalog-viewer").then((m) => m.CatalogViewer),
  { ssr: false },
);

export function CatalogWorkspace({ catalog }: { catalog: Catalog }) {
  const [page, setPage] = useState(1);
  const [activeCitation, setActiveCitation] = useState<Citation | null>(null);

  const handleCite = (citation: Citation) => {
    setActiveCitation(citation);
    setPage(citation.page);
  };
  const handlePageChange = (next: number) => {
    setPage(next);
    setActiveCitation(null);
  };

  return (
    <main className="h-screen w-full overflow-hidden">
      <ResizablePanelGroup orientation="horizontal">
        <ResizablePanel defaultSize="62" minSize="40">
          <CatalogViewer
            catalog={catalog}
            page={page}
            onPageChange={handlePageChange}
            activeCitation={activeCitation}
          />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize="38" minSize="26" maxSize="50">
          <ChatPanel
            docId={catalog.id}
            onCite={handleCite}
            activeCitationId={activeCitation?.id ?? null}
          />
        </ResizablePanel>
      </ResizablePanelGroup>
    </main>
  );
}
```

- [ ] **Step 3: Create the server page `app/catalog/[id]/page.tsx`**

```tsx
import { notFound } from "next/navigation";
import { getCatalog } from "@/lib/store";
import { CatalogWorkspace } from "@/components/catalog-workspace";

export default async function CatalogPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const catalog = await getCatalog(id);
  if (!catalog) notFound();

  return (
    <CatalogWorkspace
      catalog={{
        id: catalog.id,
        name: catalog.name,
        numPages: catalog.numPages,
        file: `api/catalog/${catalog.id}/pdf`,
      }}
    />
  );
}
```

- [ ] **Step 4: Replace `app/page.tsx` with a landing list**

```tsx
import Link from "next/link";
import { FileText } from "lucide-react";
import { listCatalogs } from "@/lib/store";

export default async function Home() {
  const catalogs = await listCatalogs();

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-2xl font-semibold">Katalog-Assistent</h1>
      <p className="text-muted-foreground mt-2 text-sm">
        Wähle einen Katalog, um Fragen dazu zu stellen.
      </p>
      <ul className="mt-8 space-y-2">
        {catalogs.length === 0 ? (
          <li className="text-muted-foreground text-sm">
            Noch keine Kataloge. Lade im{" "}
            <Link href="/admin" className="underline">
              Admin-Bereich
            </Link>{" "}
            einen hoch.
          </li>
        ) : (
          catalogs.map((c) => (
            <li key={c.id}>
              <Link
                href={`/catalog/${c.id}`}
                className="hover:bg-muted flex items-center gap-3 rounded-md border px-4 py-3"
              >
                <FileText className="h-4 w-4 shrink-0" />
                <span className="flex-1">{c.name}</span>
                <span className="text-muted-foreground font-mono text-xs">
                  {c.numPages} S.
                </span>
              </Link>
            </li>
          ))
        )}
      </ul>
    </main>
  );
}
```

- [ ] **Step 5: Type-check and smoke test**

Run: `npx tsc --noEmit`
Expected: no errors (note `app/page.tsx` no longer imports `@/lib/catalogs`).
Then `npm run dev`, open `/` (landing) and `/catalog/<id>` after Task 7 upload. Before any upload, `/` should show the empty-state message and `/catalog/anything` should 404.

- [ ] **Step 6: Commit**

```bash
git add components/catalog-viewer.tsx components/catalog-workspace.tsx app/catalog app/page.tsx
git commit -m "feat: per-catalog route + landing list; optional selector"
```

---

## Task 7: Admin dashboard (upload, edit notes, delete)

**Files:**
- Create: `app/api/admin/catalogs/route.ts` (POST upload)
- Create: `app/api/admin/catalogs/[id]/route.ts` (PATCH, DELETE)
- Create: `app/admin/page.tsx`
- Create: `components/admin-dashboard.tsx`

**Interfaces:**
- Consumes: `requireAdmin` from `lib/admin-auth.ts`; `ingestPdf`, `slugify` from `lib/ingest.ts`; `saveCatalog`, `listCatalogs`, `patchCatalog`, `removeCatalog`, `uniqueId` from `lib/store.ts`. (Auto-enrich is added in Task 8.)
- Produces: `POST /api/admin/catalogs` (multipart `file`), `PATCH/DELETE /api/admin/catalogs/<id>`, the `/admin` page.

- [ ] **Step 1: Implement the upload route `app/api/admin/catalogs/route.ts`**

```ts
import { requireAdmin } from "@/lib/admin-auth";
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
  const record: CatalogRecord = {
    id,
    name: file.name.replace(/\.pdf$/i, ""),
    numPages,
    notes: "",
    exampleQuestions: [],
    createdAt: new Date().toISOString(),
    chunks,
  };
  await saveCatalog(record, bytes);
  return Response.json({ id, name: record.name, numPages });
}
```
(`new Date().toISOString()` is fine in a route handler — the Date restriction only applies to Workflow scripts.)

- [ ] **Step 2: Implement edit/delete `app/api/admin/catalogs/[id]/route.ts`**

```ts
import { requireAdmin } from "@/lib/admin-auth";
import { patchCatalog, removeCatalog } from "@/lib/store";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await requireAdmin())) {
    return Response.json({ error: "Nicht autorisiert" }, { status: 401 });
  }
  const { id } = await params;
  const body = (await req.json()) as {
    name?: string;
    notes?: string;
    exampleQuestions?: string[];
  };
  const updated = await patchCatalog(id, body);
  if (!updated) return Response.json({ error: "Nicht gefunden" }, { status: 404 });
  return Response.json({ ok: true });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await requireAdmin())) {
    return Response.json({ error: "Nicht autorisiert" }, { status: 401 });
  }
  const { id } = await params;
  await removeCatalog(id);
  return Response.json({ ok: true });
}
```

- [ ] **Step 3: Implement the admin page `app/admin/page.tsx`**

Server component: gate on `requireAdmin`, render either the login form or the dashboard.
```tsx
import { requireAdmin } from "@/lib/admin-auth";
import { listCatalogs } from "@/lib/store";
import { AdminDashboard, AdminLogin } from "@/components/admin-dashboard";

export default async function AdminPage() {
  if (!(await requireAdmin())) return <AdminLogin />;
  const catalogs = await listCatalogs();
  return <AdminDashboard catalogs={catalogs} />;
}
```

- [ ] **Step 4: Implement `components/admin-dashboard.tsx`**

Client component with login form, upload form, and a list with editable notes + delete. Uses `BASE_PATH` for fetches and `window.location.reload()` after mutations (simple, no client cache to manage).
```tsx
"use client";

import { useState } from "react";
import { BASE_PATH } from "@/lib/base-path";
import type { CatalogMeta } from "@/lib/catalog";

const api = (path: string) => `${BASE_PATH}${path}`;

export function AdminLogin() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await fetch(api("/api/admin/login"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (res.ok) window.location.reload();
    else setError(true);
  };

  return (
    <main className="mx-auto max-w-sm px-6 py-24">
      <h1 className="text-xl font-semibold">Admin-Anmeldung</h1>
      <form onSubmit={submit} className="mt-6 space-y-3">
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Passwort"
          className="w-full rounded-md border px-3 py-2 text-sm"
        />
        {error && <p className="text-sm text-red-600">Falsches Passwort.</p>}
        <button className="w-full rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground">
          Anmelden
        </button>
      </form>
    </main>
  );
}

export function AdminDashboard({ catalogs }: { catalogs: CatalogMeta[] }) {
  const [busy, setBusy] = useState(false);

  const upload = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    if (!(form.get("file") as File)?.size) return;
    setBusy(true);
    const res = await fetch(api("/api/admin/catalogs"), {
      method: "POST",
      body: form,
    });
    setBusy(false);
    if (res.ok) window.location.reload();
    else alert((await res.json()).error ?? "Upload fehlgeschlagen.");
  };

  const saveNotes = async (id: string, notes: string) => {
    await fetch(api(`/api/admin/catalogs/${id}`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes }),
    });
  };

  const remove = async (id: string) => {
    if (!confirm("Diesen Katalog löschen?")) return;
    await fetch(api(`/api/admin/catalogs/${id}`), { method: "DELETE" });
    window.location.reload();
  };

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="text-2xl font-semibold">Kataloge verwalten</h1>

      <form onSubmit={upload} className="mt-6 flex items-center gap-3 rounded-md border p-4">
        <input type="file" name="file" accept="application/pdf" />
        <button
          disabled={busy}
          className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50"
        >
          {busy ? "Wird verarbeitet…" : "Hochladen"}
        </button>
      </form>

      <ul className="mt-8 space-y-4">
        {catalogs.map((c) => (
          <li key={c.id} className="rounded-md border p-4">
            <div className="flex items-center justify-between">
              <a href={api(`/catalog/${c.id}`)} className="font-medium underline">
                {c.name}
              </a>
              <button onClick={() => remove(c.id)} className="text-sm text-red-600">
                Löschen
              </button>
            </div>
            <NotesEditor id={c.id} initial={c.notes} onSave={saveNotes} />
          </li>
        ))}
      </ul>
    </main>
  );
}

function NotesEditor({
  id,
  initial,
  onSave,
}: {
  id: string;
  initial: string;
  onSave: (id: string, notes: string) => Promise<void>;
}) {
  const [notes, setNotes] = useState(initial);
  const [saved, setSaved] = useState(false);
  return (
    <div className="mt-3">
      <label className="text-muted-foreground text-xs">
        Zusätzlicher Kontext für die KI (z. B. Produktnamen-Varianten)
      </label>
      <textarea
        value={notes}
        onChange={(e) => {
          setNotes(e.target.value);
          setSaved(false);
        }}
        rows={3}
        className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
      />
      <button
        onClick={async () => {
          await onSave(id, notes);
          setSaved(true);
        }}
        className="mt-1 rounded-md border px-2 py-1 text-xs"
      >
        {saved ? "Gespeichert" : "Notizen speichern"}
      </button>
    </div>
  );
}
```

- [ ] **Step 5: End-to-end manual test**

Run `npm run dev`. Then:
1. Open `/admin` → login form. Enter the wrong password → "Falsches Passwort". Enter `ADMIN_PASSWORD` → dashboard.
2. Upload `test/fixtures/sample.pdf` → page reloads, catalog appears.
3. Click the catalog link → `/catalog/<id>` renders the PDF (served via the private streaming route) and the chat answers a question with citations.
4. Edit notes, save, ask a question that the notes influence.
5. Delete the catalog → it disappears and `/catalog/<id>` 404s.

Capture evidence:
```bash
curl -s -o /dev/null -w "no-auth upload => %{http_code}\n" \
  -X POST -F file=@test/fixtures/sample.pdf http://localhost:3000/api/admin/catalogs
```
Expected: `401` (guard works without the cookie).

- [ ] **Step 6: Commit**

```bash
git add app/api/admin/catalogs app/admin components/admin-dashboard.tsx
git commit -m "feat: admin dashboard for upload, notes editing, delete"
```

---

## Task 8: Auto-enrich on upload

**Files:**
- Create: `lib/enrich.ts`
- Modify: `app/api/admin/catalogs/route.ts` (call enrich before save)

**Interfaces:**
- Consumes: `@ai-sdk/google`, `generateObject` from `ai`; chunk text from `ingestPdf`.
- Produces: `enrichCatalog(input: { fallbackName: string; sampleText: string }): Promise<{ name: string; notes: string; exampleQuestions: string[] }>`.

- [ ] **Step 1: Implement `lib/enrich.ts`**

One structured Gemini call producing draft metadata. Falls back gracefully if the model errors (upload must still succeed).
```ts
import { google } from "@ai-sdk/google";
import { generateObject } from "ai";
import { z } from "zod";

const schema = z.object({
  name: z.string(),
  notes: z.string(),
  exampleQuestions: z.array(z.string()).max(5),
});

export async function enrichCatalog(input: {
  fallbackName: string;
  sampleText: string;
}): Promise<{ name: string; notes: string; exampleQuestions: string[] }> {
  try {
    const { object } = await generateObject({
      model: google("gemini-2.5-flash"),
      schema,
      prompt: `Du erhältst Auszüge aus einem Produktkatalog/Whitepaper (Deutsch).
Erzeuge als ENTWURF (ein Mensch prüft danach):
- "name": ein kurzer, sauberer Katalogname.
- "notes": Hinweise für eine KI-Suche, z. B. Produktnamen-Varianten oder Schreibweisen, die als gleichwertig gelten sollen.
- "exampleQuestions": bis zu 5 typische Nutzerfragen.

Auszug:
${input.sampleText.slice(0, 6000)}`,
    });
    return {
      name: object.name?.trim() || input.fallbackName,
      notes: object.notes?.trim() ?? "",
      exampleQuestions: object.exampleQuestions ?? [],
    };
  } catch {
    return { name: input.fallbackName, notes: "", exampleQuestions: [] };
  }
}
```
If `zod` is not already a dependency, install it: `npm install zod`. Verify first with `node -e "require('zod')"` (it is commonly transitive via the AI SDK).

- [ ] **Step 2: Wire enrich into the upload route**

In `app/api/admin/catalogs/route.ts`, after the `ingestPdf` block and before building `record`, add:
```ts
  const sampleText = chunks.slice(0, 40).map((c) => c.text).join("\n");
  const enriched = await enrichCatalog({
    fallbackName: file.name.replace(/\.pdf$/i, ""),
    sampleText,
  });
```
And change the `record` fields to use the drafts:
```ts
  const record: CatalogRecord = {
    id,
    name: enriched.name,
    numPages,
    notes: enriched.notes,
    exampleQuestions: enriched.exampleQuestions,
    createdAt: new Date().toISOString(),
    chunks,
  };
```
Add the import at the top: `import { enrichCatalog } from "@/lib/enrich";`

- [ ] **Step 3: Manual test**

Upload `test/fixtures/sample.pdf` via `/admin`. After reload, the catalog's notes textarea is pre-filled with an AI draft (or empty if the model declined), and the name is the cleaned draft. Editing + saving still works (Task 7 path). Confirm the upload still succeeds even if `GOOGLE_GENERATIVE_AI_API_KEY` is unset (enrich falls back, no crash):
```bash
# temporarily unset the key in .env.local, restart dev, upload again -> still 200
```

- [ ] **Step 4: Commit**

```bash
git add lib/enrich.ts app/api/admin/catalogs/route.ts package.json package-lock.json
git commit -m "feat: auto-enrich uploads with draft name/notes/questions"
```

---

## Task 9: Cleanup — remove the build-time module machinery

Now that everything reads from Blob, delete the obsolete generated-module path and repurpose the CLI as an optional Blob bulk-importer.

**Files:**
- Delete: `lib/catalogs.ts`, `lib/catalogs.example.ts`, `lib/chunks-data.ts`, `lib/chunks-data.example.ts`, `scripts/ensure-data.mjs`
- Modify: `lib/retrieval.ts` (drop the `CHUNKS_BY_DOC` import, or delete the file if unused)
- Modify: `package.json` (remove `predev`/`prebuild`, repoint `ingest`)
- Modify: `.gitignore` (drop the generated-file ignores)
- Rewrite: `scripts/ingest.mjs` → optional bulk import into Blob
- Modify: `lib/types.ts` is kept (still used by `Citation`)

**Interfaces:**
- Consumes: nothing new. Confirms no file imports `@/lib/catalogs` or `@/lib/chunks-data`.

- [ ] **Step 1: Find remaining references**

Run:
```bash
grep -rn "lib/catalogs\|chunks-data\|CHUNKS_BY_DOC\|resolveChunk\|ensure-data" app components lib scripts package.json
```
Expected after Tasks 5-6: only `lib/retrieval.ts` (and possibly nothing else). The chat route no longer uses `resolveChunk`.

- [ ] **Step 2: Remove dead retrieval code**

`lib/retrieval.ts` imported `CHUNKS_BY_DOC` and was never called by the live app (the chat route does its own lookup). Delete it:
```bash
git rm lib/retrieval.ts
```
If `grep -rn "lib/retrieval" app components lib` returns anything, instead refactor those callers first. Expected: no references.

- [ ] **Step 3: Delete generated modules + ensure-data**

```bash
git rm lib/catalogs.ts lib/catalogs.example.ts lib/chunks-data.ts lib/chunks-data.example.ts scripts/ensure-data.mjs
```

- [ ] **Step 4: Update `package.json` scripts**

Remove `predev` and `prebuild`. Repoint `ingest` to the new bulk importer:
```json
"dev": "next dev",
"build": "next build",
"start": "next start",
"lint": "eslint",
"test": "vitest run",
"test:watch": "vitest",
"ingest": "node scripts/ingest.mjs"
```

- [ ] **Step 5: Rewrite `scripts/ingest.mjs` as an optional Blob bulk importer**

A convenience for seeding many PDFs at once. It posts each PDF to the running admin upload route (reuses the exact same pipeline), so it needs the dev/prod server running and the admin cookie. Simplest robust form: call the Blob SDK directly is harder from a plain script (no ingest in JS), so drive the HTTP API instead.
```js
// Optional bulk importer: uploads every PDF in CATALOG_SRC to a running
// instance via the admin API. Requires the app running and an admin session.
// Usage: BASE_URL=http://localhost:3000 ADMIN_PASSWORD=... \
//        CATALOG_SRC=./source-pdfs node scripts/ingest.mjs
import { readdirSync, readFileSync } from "fs";
import { join } from "path";

const SRC = process.env.CATALOG_SRC || "./source-pdfs";
const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const password = process.env.ADMIN_PASSWORD;
if (!password) throw new Error("Set ADMIN_PASSWORD");

const login = await fetch(`${BASE_URL}/api/admin/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ password }),
});
const cookie = login.headers.get("set-cookie");
if (!login.ok || !cookie) throw new Error("Login failed");

const files = readdirSync(SRC).filter((f) => f.toLowerCase().endsWith(".pdf"));
for (const file of files) {
  const form = new FormData();
  form.append(
    "file",
    new Blob([readFileSync(join(SRC, file))], { type: "application/pdf" }),
    file,
  );
  const res = await fetch(`${BASE_URL}/api/admin/catalogs`, {
    method: "POST",
    headers: { cookie: cookie.split(";")[0] },
    body: form,
  });
  console.log(file, res.status, await res.text());
}
```

- [ ] **Step 6: Update `.gitignore`**

Remove the now-obsolete lines:
```
/public/catalogs/*
!/public/catalogs/.gitkeep
/lib/catalogs.ts
/lib/chunks-data.ts
```
(Keep `/source-pdfs/` ignored — still used by the bulk importer.)

- [ ] **Step 7: Verify the app builds clean with no generated modules**

Run:
```bash
npx tsc --noEmit && npm run build 2>&1 | tail -20
```
Expected: type-check passes and `next build` succeeds with no references to the deleted modules. Run the full test suite:
```bash
npx vitest run
```
Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor: remove build-time catalog modules; blob is sole source"
```

---

## Task 10: Branding — small igus logo top-left

**Files:**
- Add: `public/igus-logo.svg` (operator-provided asset)
- Modify: `components/catalog-viewer.tsx` (toolbar, left of the catalog name)
- Modify: `app/page.tsx` (landing header)
- Modify: `components/admin-dashboard.tsx` (dashboard + login headers)

**Interfaces:**
- Consumes: `BASE_PATH` from `@/lib/base-path`.
- Produces: a reusable inline logo element. Keep it trivial; no new component is required unless it reduces duplication.

- [ ] **Step 1: Confirm the asset is present**

```bash
ls -la public/igus-logo.svg && file public/igus-logo.svg
```
Expected: the file exists. If absent, the `alt="igus"` fallback still renders, but flag it in the report.

- [ ] **Step 2: Add the logo to the catalog toolbar**

In `components/catalog-viewer.tsx`, in the toolbar block (around line 149-152, the `flex min-w-0 items-center gap-2.5` div that holds the FileText icon and catalog name), insert before the `<FileText ...>`:
```tsx
<img
  src={`${BASE_PATH}/igus-logo.svg`}
  alt="igus"
  className="h-5 w-auto shrink-0"
/>
```
`BASE_PATH` is already imported in this file.

- [ ] **Step 3: Add the logo to the landing header (`app/page.tsx`)**

Import at the top: `import { BASE_PATH } from "@/lib/base-path";`. Place above the `<h1>`:
```tsx
<img src={`${BASE_PATH}/igus-logo.svg`} alt="igus" className="mb-4 h-5 w-auto" />
```

- [ ] **Step 4: Add the logo to the admin headers (`components/admin-dashboard.tsx`)**

`BASE_PATH` is already imported. In both `AdminLogin` (above its `<h1>`) and `AdminDashboard` (above its `<h1>`), add:
```tsx
<img src={`${BASE_PATH}/igus-logo.svg`} alt="igus" className="mb-4 h-5 w-auto" />
```

- [ ] **Step 5: Verify**

Run `npm run dev` and confirm the small logo appears top-left on `/`, `/catalog/<id>`, and `/admin`. Run `npx tsc --noEmit` (expect no errors).

- [ ] **Step 6: Commit**

```bash
git add public/igus-logo.svg app/page.tsx components/catalog-viewer.tsx components/admin-dashboard.tsx
git commit -m "feat: small igus logo top-left on viewer, landing, admin"
```

---

## Self-Review

**Spec coverage:**
- Browser upload goes live immediately → Task 7 (upload route writes to Blob, list derived live). ✓
- One catalog per URL, only that one shown → Task 6 (`/catalog/[id]`, selector hidden). ✓
- `/admin` with env password → Task 4 + Task 7. ✓
- Per-document extra retrieval context → `notes` field: Task 3 (storage), Task 5 (injected into prompt), Task 7 (edited in admin). ✓
- Auto-enrich → Task 8. ✓
- Private Blob, no index.json, PDFs via server route → Tasks 3 + 5. ✓
- MuPDF-on-Vercel validated first → Task 2 Step 7. ✓
- Remove obsolete generated-module path → Task 9. ✓

**Type consistency:** `CatalogRecord`/`CatalogMeta`/`Chunk` defined in `lib/catalog.ts` (Task 2) and used identically in Tasks 3, 5, 7, 8. Store method names (`getCatalog`, `listCatalogs`, `getCatalogPdfStream`, `getCatalogPdfBytes`, `saveCatalog`, `patchCatalog`, `removeCatalog`, `uniqueId`) are consistent across Tasks 3, 5, 6, 7. Auth names (`requireAdmin`, `signSession`, `isValidSession`, `checkPassword`, `COOKIE_NAME`) consistent across Tasks 4 and 7. The client `Catalog` type (`{id,name,numPages,file}`) is defined once in `catalog-viewer.tsx` and consumed by `catalog-workspace.tsx` (Task 6).

**Open risk flagged in-plan:** Task 2 Step 7 is the go/no-go for MuPDF inside a Next route; if it fails, stop and resolve bundling before Tasks 7-8.
