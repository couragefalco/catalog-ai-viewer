# Catalog AI Viewer

An interactive PDF catalog viewer with a grounded AI assistant. Ask a question
about a document and the assistant answers with inline citations — clicking a
citation jumps the viewer to the exact page and highlights the region the answer
came from.

- **Split view** — resizable PDF viewer (react-pdf / pdf.js) beside a chat panel.
- **Grounded answers** — the model reads the full PDF natively and tags every
  statement with a `[[chunk-id]]` marker that resolves to a page + bounding box.
- **Bring your own PDFs** — drop PDFs in a folder and run one ingest script.

## Stack

- Next.js (App Router) + React 19
- [MuPDF](https://mupdf.com) (`mupdf`) for structured-text + bbox extraction at ingest time
- Vercel AI SDK with Google Gemini for the chat endpoint
- shadcn/ui + Tailwind CSS

## Getting started

1. Install dependencies:

   ```bash
   npm install
   ```

2. Set your model API key (see `.env.example`):

   ```bash
   cp .env.example .env.local
   # then edit .env.local and set GOOGLE_GENERATIVE_AI_API_KEY
   ```

3. Add your catalog PDFs and ingest them. Put PDFs in a folder (default
   `./source-pdfs`) and run:

   ```bash
   CATALOG_SRC=./source-pdfs npm run ingest
   ```

   This copies the PDFs into `public/catalogs/` and generates the (gitignored)
   `lib/catalogs.ts` manifest and `lib/chunks-data.ts` citation data.

4. Run the dev server:

   ```bash
   npm run dev
   ```

> The PDFs and generated data files are **gitignored** — this repo ships the
> pipeline, not any catalog content. Before you run `ingest`, the project builds
> against empty stubs (`lib/*.example.ts`, copied into place automatically).

## Configuration

| Env var | Purpose |
|---|---|
| `GOOGLE_GENERATIVE_AI_API_KEY` | Google Gemini API key for the chat route. |
| `NEXT_PUBLIC_SITE_URL` | Absolute site URL used for metadata / OG tags. |
| `NEXT_PUBLIC_BASE_PATH` | Optional sub-path (e.g. `/catalog`) when served behind a reverse proxy. |

## License

This project is licensed under the **GNU Affero General Public License v3.0 or
later (AGPL-3.0-or-later)** — see [`LICENSE`](./LICENSE).

It depends on [MuPDF](https://mupdf.com), distributed by Artifex under the AGPL.
Because of MuPDF's copyleft, the combined work is AGPL. If you deploy this as a
network service, the AGPL requires you to offer the complete corresponding
source of your deployed version to its users. If that does not fit your use
case, obtain a [commercial MuPDF license from Artifex](https://artifex.com/licensing/)
or replace MuPDF with a permissively licensed PDF engine. See [`NOTICE`](./NOTICE).
