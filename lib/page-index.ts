// Seiten-Index für die globale Suche.
//
// Warum nicht Katalog-Ebene: Ein Summary-Vektor pro Katalog verwässert. Der
// Materialkatalog beschreibt fünf igumid®-Sorten, Abmessungen und Normen - die
// eine gesuchte Passage geht im Mittelwert unter, der Katalog schafft es nicht
// in die Vorauswahl und seine Chunks werden nie bewertet.
//
// Warum nicht alle Chunks: 51.224 Chunk-Vektoren à 768 Dim sind 157 MB, das
// lässt sich nicht pro Anfrage laden.
//
// Seiten sind der Mittelweg: 2.550 Stück. Der Seitenvektor ist das normierte
// Mittel seiner Chunk-Vektoren, auf 384 Dimensionen gekürzt (Matryoshka:
// text-embedding-3-large ist so trainiert, dass ein Präfix des Vektors nach
// Renormierung weiter gültig ist). Das ergibt ~3,9 MB - klein genug für einen
// warmen Cache, fein genug, damit eine einzelne Passage den Katalog zieht.

export const PAGE_INDEX_DIMS = 384;

export type PageEntry = { c: string; p: number }; // catalogId, page

export type PageIndexBlob = {
  dims: number;
  entries: PageEntry[];
  b64: string; // Float32Array, entries.length * dims
};

export type PageIndex = {
  dims: number;
  entries: PageEntry[];
  data: Float32Array;
};

export function normalize(vector: Float32Array): Float32Array {
  let sum = 0;
  for (const value of vector) sum += value * value;
  const norm = Math.sqrt(sum);
  if (norm > 0) for (let i = 0; i < vector.length; i++) vector[i] /= norm;
  return vector;
}

// Vektor auf die Index-Dimension kürzen und renormieren.
export function truncate(vector: number[], dims = PAGE_INDEX_DIMS): Float32Array {
  const out = new Float32Array(dims);
  for (let i = 0; i < dims && i < vector.length; i++) out[i] = vector[i];
  return normalize(out);
}

// Seitenvektor = normiertes Mittel der Chunk-Vektoren dieser Seite.
export function poolPageVector(
  chunkVectors: number[][],
  dims = PAGE_INDEX_DIMS,
): Float32Array {
  const out = new Float32Array(dims);
  if (!chunkVectors.length) return out;
  for (const vector of chunkVectors) {
    for (let i = 0; i < dims && i < vector.length; i++) out[i] += vector[i];
  }
  for (let i = 0; i < dims; i++) out[i] /= chunkVectors.length;
  return normalize(out);
}

export function encodePageIndex(
  entries: PageEntry[],
  vectors: Float32Array[],
  dims = PAGE_INDEX_DIMS,
): PageIndexBlob {
  const data = new Float32Array(entries.length * dims);
  vectors.forEach((vector, i) => data.set(vector, i * dims));
  return {
    dims,
    entries,
    b64: Buffer.from(data.buffer).toString("base64"),
  };
}

export function decodePageIndex(blob: PageIndexBlob): PageIndex {
  const buffer = Buffer.from(blob.b64, "base64");
  const data = new Float32Array(
    buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
  );
  return { dims: blob.dims, entries: blob.entries, data };
}

// Alle Seiten gegen die Frage scoren. Vektoren sind normiert, das Skalarprodukt
// ist also die Kosinus-Ähnlichkeit.
export function searchPages(
  query: Float32Array,
  index: PageIndex,
  topK: number,
): { entry: PageEntry; score: number }[] {
  const { dims, entries, data } = index;
  const scored: { entry: PageEntry; score: number }[] = [];
  for (let i = 0; i < entries.length; i++) {
    let dot = 0;
    const base = i * dims;
    for (let d = 0; d < dims; d++) dot += query[d] * data[base + d];
    scored.push({ entry: entries[i], score: dot });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, topK);
}
