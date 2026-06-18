import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { ingestPdf, slugify } from "../lib/ingest";

describe("slugify", () => {
  it("lowercases and dashes", () => {
    expect(slugify("DE_Factsheet PRT-01_print.pdf")).toBe(
      "de-factsheet-prt-01-print",
    );
  });
});

describe("ingestPdf", () => {
  const bytes = new Uint8Array(
    readFileSync(join(__dirname, "fixtures/sample.pdf")),
  );

  it("returns page count and chunk array", () => {
    const result = ingestPdf(bytes);
    expect(result.numPages).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(result.chunks)).toBe(true);
    for (const c of result.chunks) {
      expect(c.id).toMatch(/^p\d+-b\d+$/);
      expect(c.page).toBeGreaterThanOrEqual(1);
      expect(c.bbox.x).toBeGreaterThanOrEqual(0);
      expect(c.bbox.x).toBeLessThanOrEqual(1);
    }
  });
});
