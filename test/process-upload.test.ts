import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  ingestPdf,
  enrichCatalog,
  uniqueId,
  saveCatalog,
  saveCatalogVectors,
  embedTexts,
} = vi.hoisted(() => ({
  ingestPdf: vi.fn(),
  enrichCatalog: vi.fn(),
  uniqueId: vi.fn(),
  saveCatalog: vi.fn(),
  saveCatalogVectors: vi.fn(),
  embedTexts: vi.fn(),
}));

vi.mock("@/lib/ingest", () => ({
  ingestPdf,
  slugify: vi.fn(() => "test-katalog"),
}));

vi.mock("@/lib/enrich", () => ({
  enrichCatalog,
}));

vi.mock("@/lib/store", () => ({
  uniqueId,
  saveCatalog,
  saveCatalogVectors,
}));

vi.mock("@/lib/embeddings", () => ({
  RAG_PAGE_THRESHOLD: 20,
  embedTexts,
}));

import { processUpload } from "../lib/process-upload";

describe("processUpload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ingestPdf.mockReturnValue({
      numPages: 2,
      chunks: [{ id: "p1-b0", page: 1, bbox: { x: 0, y: 0, w: 1, h: 1 }, text: "erste seite" }],
    });
    enrichCatalog.mockResolvedValue({
      name: "Test Katalog",
      notes: "Kurznotiz",
      exampleQuestions: ["Was ist enthalten?"],
    });
    uniqueId.mockResolvedValue("test-katalog");
    saveCatalog.mockResolvedValue(undefined);
    saveCatalogVectors.mockResolvedValue(undefined);
    embedTexts.mockResolvedValue([]);
  });

  it("returns notes and example questions with the upload metadata", async () => {
    const result = await processUpload(new Uint8Array([1, 2, 3]), "Test.pdf");

    expect(result).toEqual({
      id: "test-katalog",
      name: "Test Katalog",
      numPages: 2,
      mode: "full",
      notes: "Kurznotiz",
      exampleQuestions: ["Was ist enthalten?"],
    });
  });
});
