# Catalog AI Viewer — Self-Serve Rebuild (Design)

**Date:** 2026-06-18
**Status:** Approved, pending implementation plan

## Goal

Let non-developers upload a catalog PDF in the browser and have it go live
immediately — no developer, no `npm run ingest`, no redeploy. Each catalog is
viewable at its own URL, an admin area manages catalogs and per-document
retrieval context, and uploads are auto-enriched with AI-drafted hints.

## Why the current design can't do this

Today catalogs are stored as **generated TypeScript modules**
(`lib/catalogs.ts`, `lib/chunks-data.ts`) compiled into the build, with PDFs in
`public/catalogs/`. Adding a catalog means running `scripts/ingest.mjs` offline
and redeploying. On the production target (**Vercel**, fronted by the igus proxy
at `solutions.igus.de/catalog`), the runtime filesystem is ephemeral/read-only,
so runtime uploads cannot persist to disk, and a new catalog can't appear without
a rebuild. The data layer must move to a runtime store.

## Architecture

### Storage — Vercel Blob (private)

- Store: `catalog-ai-viewer-blob` = `store_NnU2oYebKkBF6moT`, **private**, `iad1`.
- Per catalog:
  - `catalogs/{id}.pdf` — the source file.
  - `catalogs/{id}.json` — `{ id, name, numPages, notes, exampleQuestions, chunks[], createdAt }`.
    `chunks[]` = `{ id, page, bbox, text }` (same shape as today, used for citation grounding).
- **No mutable index file.** The catalog list is derived from
  `list({ prefix: 'catalogs/' })` filtered to `.json` blobs — single source of
  truth, no read-modify-write race.
- Because the store is private, the browser cannot fetch blobs directly. PDFs
  reach the viewer through a server route (below).

A new `lib/store.ts` wraps `@vercel/blob` and exposes:
`listCatalogs()`, `getCatalog(id)`, `getCatalogPdf(id)`, `putCatalog(meta, pdfBytes)`,
`updateCatalogNotes(id, notes, exampleQuestions)`, `deleteCatalog(id)`.
This replaces every `import` of `lib/catalogs.ts` / `lib/chunks-data.ts`.

### Ingest — shared module

Extract the MuPDF text+bbox chunking logic out of `scripts/ingest.mjs` into a
shared `lib/ingest.ts` (`ingestPdf(bytes) -> { numPages, chunks[] }`), used by
**both** the existing CLI script and the new upload route. One code path.

**Risk to validate first:** `mupdf` is a heavy WASM module. Running it inside a
Vercel serverless function requires `serverExternalPackages: ['mupdf']` in
`next.config.ts`, and large PDFs add cold-start weight and function time (300s
timeout gives headroom). **Validate with a throwaway upload-and-ingest test
before building the admin UI on top.** Fallback if it fails: keep ingest as a
separate step. Do not assume the fallback until the test proves it.

### Routes

| Route | Purpose |
|---|---|
| `/catalog/[id]` | Single catalog view (viewer + chat), no sidebar selector. Server component reads catalog from Blob. 404 if missing. |
| `/` | Simple landing — list of catalogs (or redirect to a default). No proprietary content. |
| `/admin` | Password-gated. Upload PDF, list catalogs, edit notes/example questions, delete. |
| `POST /api/admin/upload` | Multipart PDF → `ingestPdf` → auto-enrich → `putCatalog`. Catalog live immediately. **Guarded.** |
| `POST /api/admin/login` | Verify password, set signed httpOnly cookie. |
| `PATCH /api/admin/catalogs/[id]` | Update notes/example questions. **Guarded.** |
| `DELETE /api/admin/catalogs/[id]` | Delete catalog (pdf + json). **Guarded.** |
| `GET /api/catalog/[id]/pdf` | Stream the private PDF blob to the browser viewer (server-side read). |
| `POST /api/chat` | Existing chat. Reads catalog JSON + PDF from Blob by `docId`; injects `notes` into the system prompt. |

### Auth — single shared password, no provider

- `ADMIN_PASSWORD` in env. `/api/admin/login` compares and sets an httpOnly,
  signed cookie (HMAC with `ADMIN_SECRET`). Middleware guards `/admin` and
  `/api/admin/*` by verifying the cookie. No user accounts, no auth provider.

### Retrieval notes

Each catalog has a `notes` field (free text), editable in admin, injected into
the chat system prompt ahead of the citation candidates. This is how Jackie's
edge cases get handled (e.g. "product names like e-Ketten may appear spaced or
hyphenated; treat variants as equivalent").

### Auto-enrich (on upload)

After `ingestPdf` extracts text, **one Gemini call** drafts:
- a short description / suggested `name`,
- a few `exampleQuestions`,
- starter `notes`.

These **pre-fill** the catalog's editable fields. They are drafts a human edits
in admin before relying on them — never silently authoritative. One call per
upload, cheap.

## Environment

| Var | Purpose |
|---|---|
| `GOOGLE_GENERATIVE_AI_API_KEY` | Gemini (existing). |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob access. Not auto-wired yet — link repo to a Vercel project + `vercel env pull`, or paste into `.env.local`. |
| `ADMIN_PASSWORD` | Admin login. |
| `ADMIN_SECRET` | HMAC key for the session cookie. |
| `NEXT_PUBLIC_BASE_PATH` | `/catalog` behind the igus proxy (existing). |

## Out of scope (YAGNI)

- Multi-tenant / per-user catalogs (single shared admin password is enough now).
- A database or KV store (Blob `list()` covers the catalog index).
- Embeddings/RAG (full PDF is still sent to Gemini, as today).
- Editing/re-ingesting an existing catalog's PDF (delete + re-upload instead).

## Build order

1. Validate MuPDF-in-serverless with a throwaway test.
2. `lib/store.ts` + `lib/ingest.ts`; migrate `/api/chat` and the viewer off the
   generated modules onto Blob (PDF via `/api/catalog/[id]/pdf`).
3. `/catalog/[id]` route; `/` landing.
4. Auth (login route, cookie, middleware guard).
5. `/admin` UI + upload/patch/delete routes.
6. Auto-enrich call in the upload path.
