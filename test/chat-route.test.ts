import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  google,
  streamText,
  getCatalog,
  getCatalogPdfBytes,
  getCatalogVectors,
  embedQuery,
  topKIndices,
  incrementQuestionCount,
} = vi.hoisted(() => ({
  google: vi.fn(),
  streamText: vi.fn(),
  getCatalog: vi.fn(),
  getCatalogPdfBytes: vi.fn(),
  getCatalogVectors: vi.fn(),
  embedQuery: vi.fn(),
  topKIndices: vi.fn(),
  incrementQuestionCount: vi.fn(),
}));

vi.mock("@ai-sdk/google", () => ({
  google,
}));

vi.mock("ai", () => ({
  streamText,
}));

vi.mock("@/lib/store", () => ({
  getCatalog,
  getCatalogPdfBytes,
  getCatalogVectors,
}));

vi.mock("@/lib/embeddings", () => ({
  embedQuery,
  topKIndices,
}));

vi.mock("@/lib/account", () => ({
  incrementQuestionCount,
}));

import { POST } from "../app/api/chat/route";

describe("chat route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCatalog.mockResolvedValue({
      id: "catalog-1",
      name: "Catalog",
      mode: "full",
      chunks: [{ id: "p1-b1", page: 1, bbox: [0, 0, 1, 1], text: "Chunk" }],
      notes: "",
    });
    incrementQuestionCount.mockResolvedValue({ ok: true });
    getCatalogPdfBytes.mockResolvedValue(new Uint8Array([1, 2, 3]));
    getCatalogVectors.mockResolvedValue(null);
    embedQuery.mockResolvedValue([0.1]);
    topKIndices.mockReturnValue([0]);
    google.mockReturnValue("gemini-model");
    streamText.mockReturnValue({
      textStream: (async function* () {
        yield "Antwort";
      })(),
    });
  });

  it("returns the free-limit message before model execution", async () => {
    incrementQuestionCount.mockResolvedValueOnce({
      ok: false,
      reason: "FREE_QUESTION_LIMIT",
    });

    const response = await POST(
      new Request("http://localhost/api/chat", {
        method: "POST",
        body: JSON.stringify({
          docId: "catalog-1",
          messages: [{ role: "user", text: "Was steht drin?" }],
        }),
        headers: {
          "content-type": "application/json",
        },
      }),
    );

    await expect(response.text()).resolves.toBe(
      "Das kostenlose Fragenlimit für diesen Katalog ist erreicht.\x1e[]",
    );
    expect(response.headers.get("content-type")).toBe(
      "text/plain; charset=utf-8",
    );
    expect(incrementQuestionCount).toHaveBeenCalledWith("catalog-1");
    expect(streamText).not.toHaveBeenCalled();
  });
});
