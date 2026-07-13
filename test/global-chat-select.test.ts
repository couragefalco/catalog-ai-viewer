import { describe, it, expect } from "vitest";
import {
  selectChunks,
  MAX_CHUNKS_PER_CATALOG,
  MAX_CHUNKS_WITH_CONTEXT,
} from "../lib/global-retrieval";
import type { Chunk } from "../lib/catalog";

const chunk = (id: string, page = 1): Chunk => ({
  id,
  page,
  bbox: { x: 0, y: 0, w: 1, h: 1 },
  text: id,
});

const candidate = (
  id: string,
  catalogId: string,
  perQuery: number[],
  page = 1,
) => ({
  id,
  catalogId,
  catalogName: catalogId,
  chunk: chunk(id, page),
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

  it("caps how many ranked passages a single catalog contributes", () => {
    // Alle auf verschiedenen Seiten: keine Seiten-Nachbarn zum Ergänzen.
    const many = Array.from({ length: 20 }, (_, i) =>
      candidate(`x${i}`, "one-catalog", [0.9 - i * 0.01], i + 1),
    );
    const chosen = selectChunks(many, 1);
    expect(chosen.length).toBe(MAX_CHUNKS_PER_CATALOG);
  });

  it("pulls in the rest of a hit's page as context", () => {
    // Ein starker Treffer auf Seite 1 plus Nachbarabsätze derselben Seite:
    // die Nachbarn sollen mitkommen, auch über den Katalog-Deckel hinaus.
    const hit = candidate("materials-hit", "materials", [0.8], 1);
    const siblings = Array.from({ length: 9 }, (_, i) =>
      candidate(`sib${i}`, "materials", [0.2], 1),
    );
    const other = Array.from({ length: 10 }, (_, i) =>
      candidate(`o${i}`, `other-${i}`, [0.5], 1),
    );

    const chosen = selectChunks([hit, ...siblings, ...other], 1);
    const fromMaterials = chosen.filter((c) => c.catalogId === "materials");
    expect(fromMaterials.length).toBeGreaterThan(MAX_CHUNKS_PER_CATALOG);
    expect(chosen.length).toBeLessThanOrEqual(MAX_CHUNKS_WITH_CONTEXT);
    expect(new Set(chosen.map((c) => c.id)).size).toBe(chosen.length);
  });

  it("never returns the same chunk twice", () => {
    const items = Array.from({ length: 10 }, (_, i) =>
      candidate(`d${i}`, `cat-${i}`, [0.5, 0.5]),
    );
    const chosen = selectChunks(items, 2);
    expect(new Set(chosen.map((c) => c.id)).size).toBe(chosen.length);
  });
});
