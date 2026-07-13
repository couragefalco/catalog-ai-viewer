import { describe, it, expect } from "vitest";
import { selectChunks, MAX_CHUNKS_PER_CATALOG } from "../app/api/chat/global/route";
import type { Chunk } from "../lib/catalog";

const chunk = (id: string): Chunk => ({
  id,
  page: 1,
  bbox: { x: 0, y: 0, w: 1, h: 1 },
  text: id,
});

const candidate = (
  id: string,
  catalogId: string,
  perQuery: number[],
) => ({
  id,
  catalogId,
  catalogName: catalogId,
  chunk: chunk(id),
  score: Math.max(...perQuery),
  perQuery,
});

describe("selectChunks", () => {
  it("gives the weaker sub-question its own citations", () => {
    // Teilfrage 0 hat lauter starke Treffer, Teilfrage 1 nur schwache.
    // Ohne Kontingent würde Thema 1 komplett verdrängt.
    const strong = Array.from({ length: 30 }, (_, i) =>
      candidate(`a${i}`, `cat-a${i}`, [0.9, 0.1]),
    );
    const weak = Array.from({ length: 5 }, (_, i) =>
      candidate(`b${i}`, `cat-b${i}`, [0.1, 0.45]),
    );

    const chosen = selectChunks([...strong, ...weak], 2);
    const topics = chosen.filter((c) => c.id.startsWith("b"));
    expect(topics.length).toBeGreaterThan(0);
    expect(chosen.length).toBeLessThanOrEqual(24);
  });

  it("caps how many passages a single catalog contributes", () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      candidate(`x${i}`, "one-catalog", [0.9 - i * 0.01]),
    );
    const chosen = selectChunks(many, 1);
    expect(chosen.length).toBe(MAX_CHUNKS_PER_CATALOG);
  });

  it("never returns the same chunk twice", () => {
    const items = Array.from({ length: 10 }, (_, i) =>
      candidate(`d${i}`, `cat-${i}`, [0.5, 0.5]),
    );
    const chosen = selectChunks(items, 2);
    expect(new Set(chosen.map((c) => c.id)).size).toBe(chosen.length);
  });
});
