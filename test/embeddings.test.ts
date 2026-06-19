import { describe, it, expect } from "vitest";
import { topKIndices } from "../lib/embeddings";

describe("topKIndices", () => {
  it("ranks by cosine similarity to the query", () => {
    const query = [1, 0, 0];
    const vectors = [
      [0, 1, 0], // orthogonal
      [1, 0, 0], // identical -> best
      [0.9, 0.1, 0], // close
    ];
    expect(topKIndices(query, vectors, 2)).toEqual([1, 2]);
  });
  it("respects k and never exceeds vector count", () => {
    expect(topKIndices([1, 0], [[1, 0]], 5)).toEqual([0]);
  });
});
