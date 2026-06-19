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
  mode: "full" | "rag"; // "rag" = Embedding-Retrieval (>= RAG_PAGE_THRESHOLD Seiten)
};

export type CatalogRecord = CatalogMeta & { chunks: Chunk[] };
