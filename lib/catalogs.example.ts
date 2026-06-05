// Example stub. `scripts/ingest.mjs` generates the real (gitignored)
// lib/catalogs.ts from your own PDFs. This stub is copied into place by
// `scripts/ensure-data.mjs` so the project type-checks before you run ingest.
export type Catalog = {
  id: string;
  name: string;
  file: string; // public-relative path, prefix with BASE_PATH to load
  numPages: number;
};

export const CATALOGS: Catalog[] = [];
export const DEFAULT_CATALOG_ID = "";
