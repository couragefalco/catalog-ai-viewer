import { describe, it, expect } from "vitest";
import {
  decodePageIndex,
  encodePageIndex,
  poolPageVector,
  searchPages,
  truncate,
} from "../lib/page-index";

const DIMS = 4;
const unit = (v: number[]) => {
  const n = Math.sqrt(v.reduce((a, x) => a + x * x, 0));
  return v.map((x) => x / n);
};

describe("truncate", () => {
  it("keeps the prefix and renormalises to unit length", () => {
    const out = truncate([0.6, 0.8, 5, 5], 2);
    expect(out.length).toBe(2);
    const norm = Math.sqrt(out[0] ** 2 + out[1] ** 2);
    expect(norm).toBeCloseTo(1, 5);
    expect(out[0]).toBeCloseTo(0.6, 5);
  });

  it("zero-pads when the source is shorter than the target", () => {
    const out = truncate([1, 0], 4);
    expect(out.length).toBe(4);
    expect([...out]).toEqual([1, 0, 0, 0]);
  });
});

describe("poolPageVector", () => {
  it("averages chunk vectors into a unit vector", () => {
    const out = poolPageVector([unit([1, 0, 0, 0]), unit([0, 1, 0, 0])], DIMS);
    expect(Math.sqrt([...out].reduce((a, x) => a + x * x, 0))).toBeCloseTo(1, 5);
    expect(out[0]).toBeCloseTo(out[1], 5);
  });

  it("returns zeros for a page with no chunks", () => {
    expect([...poolPageVector([], DIMS)]).toEqual([0, 0, 0, 0]);
  });
});

describe("encode/decode + searchPages", () => {
  const entries = [
    { c: "materials", p: 1 },
    { c: "story", p: 4 },
  ];
  const vectors = [
    new Float32Array(unit([1, 0.1, 0, 0])),
    new Float32Array(unit([0, 0, 1, 0.2])),
  ];

  it("round-trips through base64 without losing the vectors", () => {
    const index = decodePageIndex(encodePageIndex(entries, vectors, DIMS));
    expect(index.entries).toEqual(entries);
    expect(index.data.length).toBe(entries.length * DIMS);
    expect(index.data[0]).toBeCloseTo(vectors[0][0], 5);
  });

  it("ranks the page whose vector points at the query first", () => {
    const index = decodePageIndex(encodePageIndex(entries, vectors, DIMS));
    const hits = searchPages(new Float32Array(unit([1, 0, 0, 0])), index, 2);
    expect(hits[0].entry.c).toBe("materials");
    expect(hits[0].score).toBeGreaterThan(hits[1].score);
  });
});
