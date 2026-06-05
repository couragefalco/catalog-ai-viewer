// Client-safe citation shape resolved by the chat API and consumed by the
// viewer to jump to a page and draw the highlight.
export type Citation = {
  id: string;
  page: number;
  bbox: { x: number; y: number; w: number; h: number };
  snippet: string;
};
