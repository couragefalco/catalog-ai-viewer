// Invertierter Wort-Index über den VOLLTEXT aller Kataloge.
//
// Warum: Der globale Chat kann bei >1000 Katalogen nicht jeden Katalog laden.
// Die Vorauswahl lief bisher nur über Summary-Vektoren + Name/Notizen, wodurch
// exakte Fachbegriffe (z. B. "igumid", "Dauergebrauchstemperatur") untergingen.
// Der Index liefert dafür ein günstiges Keyword-Signal: pro Suchbegriff nur ein
// Lookup, statt 1.211 Volltexte zu scannen.

export type SearchIndex = {
  ids: string[]; // Katalog-IDs, Position = docIndex
  postings: Record<string, number[]>; // term -> docIndex[]
};

const STOP = new Set([
  "und", "der", "die", "das", "den", "dem", "des", "ein", "eine", "einen",
  "für", "mit", "von", "bei", "aus", "auf", "ist", "sind", "wird", "werden",
  "kann", "können", "auch", "nicht", "sich", "zum", "zur", "als", "wie", "was",
  "welche", "welcher", "welches", "hat", "haben", "the", "and", "for", "with",
  "from", "are", "was", "you", "your", "our", "its", "this", "that", "can",
  "all", "any", "has", "have", "www", "https", "http", "igus", "eu", "com",
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[®™©]/g, " ")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 3 && t.length <= 32 && !STOP.has(t));
}

export function uniqueTerms(text: string): string[] {
  return [...new Set(tokenize(text))];
}

export function buildSearchIndex(
  docs: { id: string; terms: string[] }[],
): SearchIndex {
  const ids = docs.map((d) => d.id);
  const postings: Record<string, number[]> = {};
  docs.forEach((doc, i) => {
    for (const term of doc.terms) {
      (postings[term] ??= []).push(i);
    }
  });
  return { ids, postings };
}

// IDF-gewichtete Übereinstimmung: seltene Begriffe (z. B. "igumid") zählen weit
// mehr als häufige. Ergebnis ist pro Katalog auf 0..1 normiert.
export function lexicalScores(
  query: string,
  index: SearchIndex,
): Map<number, number> {
  const terms = [...new Set(tokenize(query))];
  const total = index.ids.length;
  const scores = new Map<number, number>();
  if (!terms.length || !total) return scores;

  let maxPossible = 0;
  for (const term of terms) {
    const docs = index.postings[term];
    if (!docs?.length) continue;
    // Begriffe, die in fast jedem Katalog vorkommen, tragen kaum Information.
    const idf = Math.log(total / docs.length);
    if (idf <= 0) continue;
    maxPossible += idf;
    for (const doc of docs) {
      scores.set(doc, (scores.get(doc) ?? 0) + idf);
    }
  }
  if (maxPossible <= 0) return new Map();
  for (const [doc, score] of scores) scores.set(doc, score / maxPossible);
  return scores;
}
