# Large Uploads + Conditional RAG Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Support large PDF uploads (bypass Vercel's 4.5 MB function-body limit via Blob client uploads) and add embedding-based retrieval for catalogs with >= 20 pages, while small catalogs keep the current full-PDF-to-Gemini path.

**Architecture:** Browser uploads the PDF directly to private Blob with a presigned token; a server `ingest` route then reads it, extracts chunks (MuPDF), enriches (Gemini), and — only when `numPages >= 20` — computes per-chunk embeddings (Google `gemini-embedding-001`, 768-dim) stored in a sibling `.vec.json` blob and marks the catalog `mode: "rag"`. The chat route branches on `mode`: `rag` embeds the question, cosine-ranks chunks, and sends only the top-K chunk texts to Gemini (no full PDF); `full` keeps current behavior. Shared `processUpload()` is used by both the new ingest route and the legacy multipart route.

**Tech Stack:** Next.js 16.2.7, `@vercel/blob` 2.4.1 (+ `/client`), `ai` 6 (`embed`/`embedMany`/`cosineSimilarity`), `@ai-sdk/google` 3 (`google.textEmbedding`), Vitest.

## Global Constraints

- Node.js runtime on all new routes (`export const runtime = "nodejs"`); never edge. Auth-gate every admin route with `requireAdmin()` first.
- Reuse the existing `GOOGLE_GENERATIVE_AI_API_KEY`. Embedding model: `google.textEmbedding("gemini-embedding-001")` with `providerOptions: { google: { outputDimensionality: 768 } }`. NO new env var, NO new service.
- Confirmed installed APIs (use exactly these): `@vercel/blob/client` exports `upload` and `handleUpload`; `ai` exports `embed`, `embedMany`, `cosineSimilarity`.
- Blob keys stay deterministic + private + `allowOverwrite: true`. New vector blob: `catalogs/<id>.vec.json`. Client uploads land under `pending/` with `addRandomSuffix`.
- RAG threshold: `RAG_PAGE_THRESHOLD = 20` (a catalog with `numPages >= 20` is `rag`). Existing catalogs lack a `mode` field — read it as `"full"` when absent.
- German UI copy, no em dashes. Keep `tsc --noEmit` clean and `npm run build` succeeding after every task.

---

## Task 1: Types, embeddings module, store vector methods

**Files:** Modify `lib/catalog.ts`, `lib/store.ts`; Create `lib/embeddings.ts`, `test/embeddings.test.ts`; extend `test/store.test.ts`.

**Interfaces produced:**
- `lib/catalog.ts`: add `mode: "full" | "rag"` to `CatalogMeta` (so `CatalogRecord` gets it too).
- `lib/embeddings.ts`:
  - `RAG_PAGE_THRESHOLD = 20`
  - `embedTexts(texts: string[]): Promise<number[][]>`
  - `embedQuery(text: string): Promise<number[]>`
  - `topKIndices(query: number[], vectors: number[][], k: number): number[]`
- `lib/store.ts`: `saveCatalogVectors(id: string, vectors: number[][]): Promise<void>`, `getCatalogVectors(id: string): Promise<number[][] | null>`; `removeCatalog` also deletes the `.vec.json`; `getCatalog` normalizes missing `mode` to `"full"`; add `getBlobBytes(pathname: string): Promise<Uint8Array | null>`.

- [ ] **Step 1: `lib/embeddings.ts`**
```ts
import { google } from "@ai-sdk/google";
import { embed, embedMany, cosineSimilarity } from "ai";

// Catalogs with at least this many pages use embedding-based retrieval (RAG);
// smaller ones send the whole PDF to Gemini.
export const RAG_PAGE_THRESHOLD = 20;

const MODEL = google.textEmbedding("gemini-embedding-001");
// 768-dim keeps the stored vectors small; cosineSimilarity normalizes anyway.
const providerOptions = { google: { outputDimensionality: 768 } };

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const { embeddings } = await embedMany({
    model: MODEL,
    values: texts,
    providerOptions,
    maxParallelCalls: 2,
  });
  return embeddings;
}

export async function embedQuery(text: string): Promise<number[]> {
  const { embedding } = await embed({ model: MODEL, value: text, providerOptions });
  return embedding;
}

export function topKIndices(
  query: number[],
  vectors: number[][],
  k: number,
): number[] {
  return vectors
    .map((v, i) => ({ i, score: cosineSimilarity(query, v) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map((x) => x.i);
}
```

- [ ] **Step 2: failing test `test/embeddings.test.ts`** (pure cosine logic, no network)
```ts
import { describe, it, expect } from "vitest";
import { topKIndices } from "../lib/embeddings";

describe("topKIndices", () => {
  it("ranks by cosine similarity to the query", () => {
    const query = [1, 0, 0];
    const vectors = [
      [0, 1, 0], // orthogonal
      [1, 0, 0], // identical -> best
      [0.9, 0.1, 0], // close
    ];
    expect(topKIndices(query, vectors, 2)).toEqual([1, 2]);
  });
  it("respects k and never exceeds vector count", () => {
    expect(topKIndices([1, 0], [[1, 0]], 5)).toEqual([0]);
  });
});
```
Run: `npx vitest run test/embeddings.test.ts` -> FAIL (no module). Then implement Step 1 -> PASS.

- [ ] **Step 3: `lib/catalog.ts`** add the field
```ts
export type CatalogMeta = {
  id: string;
  name: string;
  numPages: number;
  notes: string;
  exampleQuestions: string[];
  createdAt: string;
  mode: "full" | "rag"; // "rag" = embedding retrieval (>= RAG_PAGE_THRESHOLD pages)
};
```

- [ ] **Step 4: `lib/store.ts`** add vector + bytes helpers, normalize mode, delete vec on remove
```ts
const vecKey = (id: string) => `${PREFIX}${id}.vec.json`;

// in getCatalog, after parsing the record, normalize legacy records:
//   return { ...record, mode: record.mode ?? "full" };

export async function saveCatalogVectors(id: string, vectors: number[][]): Promise<void> {
  await put(vecKey(id), JSON.stringify(vectors), {
    access: "private",
    allowOverwrite: true,
    contentType: "application/json",
  });
}

export async function getCatalogVectors(id: string): Promise<number[][] | null> {
  const res = await get(vecKey(id), ACCESS);
  if (!res || res.statusCode !== 200 || !res.stream) return null;
  return (await new Response(res.stream).json()) as number[][];
}

export async function getBlobBytes(pathname: string): Promise<Uint8Array | null> {
  const res = await get(pathname, ACCESS);
  if (!res || res.statusCode !== 200 || !res.stream) return null;
  return new Uint8Array(await new Response(res.stream).arrayBuffer());
}

// removeCatalog: also del(vecKey(id)) alongside json + pdf.
```

- [ ] **Step 5: extend `test/store.test.ts`** — add a test that `saveCatalogVectors` + `getCatalogVectors` round-trip, and that `getCatalog` returns `mode: "full"` for a record saved without `mode`. Update the existing `record()` helper to include `mode: "full"`. Run `npx vitest run` -> all green.

- [ ] **Step 6: typecheck + commit**
Run `npx tsc --noEmit` (clean) and `npx vitest run` (green). Commit `lib/embeddings.ts lib/catalog.ts lib/store.ts test/embeddings.test.ts test/store.test.ts`:
`git commit -m "feat: embeddings module, catalog mode, blob vector store"`

NOTE: adding `mode` to `CatalogMeta` will surface tsc errors anywhere a `CatalogRecord`/`CatalogMeta` literal is built without `mode` (the upload route, store tests). Fix those in the same task by adding `mode` (the upload route is reworked in Task 2 to set it via `processUpload`, but to keep tsc green now, temporarily set `mode: numPages >= 20 ? "rag" : "full"` inline there or `"full"`; Task 2 replaces that code).

---

## Task 2: Shared processUpload + client-upload token route + ingest route

**Files:** Create `lib/process-upload.ts`, `app/api/admin/blob-upload/route.ts`, `app/api/admin/ingest/route.ts`; Modify `app/api/admin/catalogs/route.ts`.

**Interfaces produced:**
- `lib/process-upload.ts`: `processUpload(bytes: Uint8Array, filename: string): Promise<{ id: string; name: string; numPages: number; mode: "full" | "rag" }>` — throws if `ingestPdf` fails (caller maps to 422).
- `POST /api/admin/blob-upload` — presigned client-upload token (admin-gated).
- `POST /api/admin/ingest` — body `{ pathname: string; filename: string }`, processes an already-uploaded pending blob.

- [ ] **Step 1: `lib/process-upload.ts`**
```ts
import { enrichCatalog } from "@/lib/enrich";
import { ingestPdf, slugify } from "@/lib/ingest";
import { saveCatalog, saveCatalogVectors, uniqueId } from "@/lib/store";
import { RAG_PAGE_THRESHOLD, embedTexts } from "@/lib/embeddings";
import type { CatalogRecord } from "@/lib/catalog";

export async function processUpload(
  bytes: Uint8Array,
  filename: string,
): Promise<{ id: string; name: string; numPages: number; mode: "full" | "rag" }> {
  const { numPages, chunks } = ingestPdf(bytes); // throws on bad PDF
  const id = await uniqueId(slugify(filename) || "katalog");
  const sampleText = chunks.slice(0, 40).map((c) => c.text).join("\n");
  const enriched = await enrichCatalog({
    fallbackName: filename.replace(/\.pdf$/i, ""),
    sampleText,
  });
  const mode: "full" | "rag" = numPages >= RAG_PAGE_THRESHOLD ? "rag" : "full";
  const record: CatalogRecord = {
    id,
    name: enriched.name,
    numPages,
    notes: enriched.notes,
    exampleQuestions: enriched.exampleQuestions,
    createdAt: new Date().toISOString(),
    mode,
    chunks,
  };
  await saveCatalog(record, bytes);
  if (mode === "rag") {
    const vectors = await embedTexts(chunks.map((c) => c.text));
    await saveCatalogVectors(id, vectors);
  }
  return { id, name: record.name, numPages, mode };
}
```

- [ ] **Step 2: rewrite `app/api/admin/catalogs/route.ts`** to delegate to `processUpload` (keeps the legacy multipart path working for the bulk-import script and <4.5MB files)
```ts
import { requireAdmin } from "@/lib/admin-auth";
import { processUpload } from "@/lib/process-upload";

export const runtime = "nodejs";
export const maxDuration = 300;

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
  try {
    const result = await processUpload(bytes, file.name);
    return Response.json(result);
  } catch {
    return Response.json({ error: "PDF konnte nicht verarbeitet werden." }, { status: 422 });
  }
}
```

- [ ] **Step 3: `app/api/admin/blob-upload/route.ts`** (presigned token; gate inside onBeforeGenerateToken)
```ts
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { requireAdmin } from "@/lib/admin-auth";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  const body = (await req.json()) as HandleUploadBody;
  try {
    const json = await handleUpload({
      request: req,
      body,
      onBeforeGenerateToken: async () => {
        if (!(await requireAdmin())) throw new Error("Nicht autorisiert");
        return {
          access: "private",
          addRandomSuffix: true,
          allowedContentTypes: ["application/pdf"],
          maximumSizeInBytes: 200 * 1024 * 1024, // 200 MB cap
        };
      },
      onUploadCompleted: async () => {
        // Ingest is triggered by the client via /api/admin/ingest; nothing here.
      },
    });
    return Response.json(json);
  } catch (e) {
    return Response.json(
      { error: (e as Error).message || "Upload nicht autorisiert" },
      { status: 401 },
    );
  }
}
```
Confirm the option names against `node_modules/@vercel/blob/dist/client/index.d.ts` (`onBeforeGenerateToken` return type — `access`, `addRandomSuffix`, `allowedContentTypes`, `maximumSizeInBytes`, `tokenPayload`). Adjust to the exact installed shape if different; keep the admin gate.

- [ ] **Step 4: `app/api/admin/ingest/route.ts`**
```ts
import { requireAdmin } from "@/lib/admin-auth";
import { getBlobBytes, removeBlob } from "@/lib/store";
import { processUpload } from "@/lib/process-upload";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request) {
  if (!(await requireAdmin())) {
    return Response.json({ error: "Nicht autorisiert" }, { status: 401 });
  }
  const { pathname, filename } = (await req.json()) as {
    pathname?: string;
    filename?: string;
  };
  if (!pathname || !filename) {
    return Response.json({ error: "pathname und filename erforderlich" }, { status: 400 });
  }
  const bytes = await getBlobBytes(pathname);
  if (!bytes) {
    return Response.json({ error: "Hochgeladene Datei nicht gefunden." }, { status: 404 });
  }
  try {
    const result = await processUpload(bytes, filename);
    await removeBlob(pathname); // clean up the pending upload
    return Response.json(result);
  } catch {
    return Response.json({ error: "PDF konnte nicht verarbeitet werden." }, { status: 422 });
  }
}
```
Add `removeBlob(pathname: string)` to `lib/store.ts` (`await del(pathname)`).

- [ ] **Step 5: typecheck + build + commit**
`npx tsc --noEmit` clean; `npm run build` succeeds; `npx vitest run` green. Commit the 4 files + `lib/store.ts`:
`git commit -m "feat: large-file client upload + server ingest via shared processUpload"`

---

## Task 3: Admin UI client upload + chat RAG retrieval

**Files:** Modify `components/admin-dashboard.tsx`, `app/api/chat/route.ts`.

- [ ] **Step 1: client upload in `components/admin-dashboard.tsx`**
Replace the `upload` handler so the browser uploads directly to Blob, then triggers ingest. Show clear progress + errors (no more silent 413). Use the `upload` import from `@vercel/blob/client`.
```tsx
import { upload } from "@vercel/blob/client";
// ...
const [status, setStatus] = useState<string>("");

const doUpload = async (e: React.FormEvent<HTMLFormElement>) => {
  e.preventDefault();
  const input = e.currentTarget.elements.namedItem("file") as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  if (!file.name.toLowerCase().endsWith(".pdf")) {
    alert("Bitte eine PDF-Datei wählen.");
    return;
  }
  setBusy(true);
  try {
    setStatus("Datei wird hochgeladen…");
    const blob = await upload(`pending/${file.name}`, file, {
      access: "private",
      handleUploadUrl: api("/api/admin/blob-upload"),
      contentType: "application/pdf",
    });
    setStatus("Wird verarbeitet (Text + KI)…");
    const res = await fetch(api("/api/admin/ingest"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pathname: blob.pathname, filename: file.name }),
    });
    if (!res.ok) {
      const msg = await res.text();
      throw new Error(msg || "Verarbeitung fehlgeschlagen.");
    }
    window.location.reload();
  } catch (err) {
    alert(`Upload fehlgeschlagen: ${(err as Error).message}`);
  } finally {
    setBusy(false);
    setStatus("");
  }
};
```
Wire the form `onSubmit={doUpload}`; show `{status}` next to the button; the button label uses `busy ? "Bitte warten…" : "Hochladen"`. Keep the file input `name="file"`. Note in small helper text that große PDFs (auch hunderte Seiten) jetzt unterstützt werden.

- [ ] **Step 2: confirm `upload()` option names** against `node_modules/@vercel/blob/dist/client/index.d.ts` (`handleUploadUrl`, `access`, `contentType`, `multipart`). For very large files consider `multipart: true`. Adjust to the installed signature.

- [ ] **Step 3: chat RAG branch in `app/api/chat/route.ts`**
After loading `catalog` and `chunks`, branch:
```ts
import { getCatalog, getCatalogPdfBytes, getCatalogVectors } from "@/lib/store";
import { embedQuery, topKIndices } from "@/lib/embeddings";
// ...
const lastUser = [...messages].reverse().find((m) => m.role === "user");
let candidateChunks = chunks;
let attachPdf = true;

if (catalog.mode === "rag" && lastUser) {
  const vectors = await getCatalogVectors(docId);
  if (vectors && vectors.length === chunks.length) {
    const q = await embedQuery(lastUser.text);
    const idx = topKIndices(q, vectors, 16);
    candidateChunks = idx.map((i) => chunks[i]);
    attachPdf = false; // do NOT send the whole (huge) PDF
  }
}
```
Then build `candidates` from `candidateChunks` (same `[id] (Seite X) text` format). When `attachPdf` is false, do NOT attach `pdfBytes` to the user message and add a line to the system prompt: instruct Gemini to answer ONLY from the provided excerpts and cite their `[[chunk-id]]`. When `attachPdf` is true, keep the exact current behavior (full PDF attached, all chunks as candidates). The citation resolver must use a map built from `candidateChunks` (rag) or all `chunks` (full) so every cited id resolves. Keep the `\x1e` streaming protocol and the existing regex/slice constants unchanged.

- [ ] **Step 4: typecheck + build + commit**
`npx tsc --noEmit` clean; `npm run build` succeeds; `npx vitest run` green. Commit `components/admin-dashboard.tsx app/api/chat/route.ts`:
`git commit -m "feat: client upload UI + RAG retrieval for large catalogs in chat"`

---

## Self-Review
- Large upload bypasses 4.5 MB: client `upload()` -> Blob direct, ingest reads from Blob (Task 2/3). ✓
- Embeddings only >= 20 pages: `processUpload` sets `mode` by `RAG_PAGE_THRESHOLD`; vectors saved only for `rag`. ✓
- No new embedding service/key: `gemini-embedding-001` via existing key. ✓
- Chat uses retrieval for `rag`, full PDF for `full`; citations resolve in both. ✓
- Legacy multipart route + bulk script still work (delegates to `processUpload`). ✓
- Existing 49 catalogs (<20 pages, no `mode`) read as `full` — unchanged behavior. ✓
