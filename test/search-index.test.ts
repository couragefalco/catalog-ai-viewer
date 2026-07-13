import { describe, it, expect } from "vitest";
import {
  buildSearchIndex,
  lexicalScores,
  tokenize,
  uniqueTerms,
} from "../lib/search-index";

const docs = [
  {
    id: "ecs-materials",
    terms: uniqueTerms(
      "Overview of energy chain materials igumid G LW continuous temperatures -40°C",
    ),
  },
  {
    id: "igus-story",
    terms: uniqueTerms(
      "Fakten - Die Geschichte hinter igus. Testlabor, Roadshow, Mitarbeiter, Umsatz.",
    ),
  },
  {
    id: "prt-01",
    terms: uniqueTerms("Drehkranzlager PRT-01 Bauserie Abmessungen"),
  },
];

describe("tokenize", () => {
  it("drops stopwords, short tokens and ®", () => {
    expect(tokenize("Der igumid® G Werkstoff ist für die Kette")).toEqual([
      "igumid",
      "werkstoff",
      "kette",
    ]);
  });
});

describe("lexicalScores", () => {
  const index = buildSearchIndex(docs);

  it("ranks a rare product term above unrelated docs", () => {
    const scores = lexicalScores("Welches igumid Material?", index);
    const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
    expect(index.ids[ranked[0][0]]).toBe("ecs-materials");
  });

  // Der Korpus ist gemischt deutsch/englisch. Ein deutscher Begriff trifft
  // einen englischen Katalog lexikalisch NICHT - diese Brücke schlägt allein
  // die Vektor-Stufe. Der Keyword-Index liefert dafür die sprachneutralen
  // Produkt- und Werkstoffnamen (igumid, iglidur, PRT-01).
  it("does not match a German query term against an English doc", () => {
    const scores = lexicalScores("Energieketten Werkstoff", index);
    const materialsIndex = index.ids.indexOf("ecs-materials");
    expect(scores.get(materialsIndex) ?? 0).toBe(0);
  });

  it("scores a doc without any query term at zero", () => {
    const scores = lexicalScores("igumid Werkstoff", index);
    const storyIndex = index.ids.indexOf("igus-story");
    expect(scores.get(storyIndex) ?? 0).toBe(0);
  });

  it("normalises scores to at most 1", () => {
    const scores = lexicalScores("igumid materials energy chain", index);
    for (const score of scores.values()) expect(score).toBeLessThanOrEqual(1);
  });

  it("returns nothing for a query of only stopwords", () => {
    expect(lexicalScores("und die der", index).size).toBe(0);
  });
});
