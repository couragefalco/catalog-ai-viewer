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
