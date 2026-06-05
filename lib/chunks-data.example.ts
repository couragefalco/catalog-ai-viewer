// Example stub. `scripts/ingest.mjs` generates the real (gitignored, server-only)
// lib/chunks-data.ts from your own PDFs. This stub is copied into place by
// `scripts/ensure-data.mjs` so the project type-checks before you run ingest.
export type Chunk = {
  id: string;
  page: number;
  bbox: { x: number; y: number; w: number; h: number };
  text: string;
};

export const CHUNKS_BY_DOC: Record<string, Chunk[]> = {};
