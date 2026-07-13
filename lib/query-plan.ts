import { generateObject } from "ai";
import { z } from "zod";
import { getChatModel } from "@/lib/chat-model";

// Zwei Probleme, die eine rohe Nutzerfrage in dieser Suche hat:
//
// 1. Mehrteilige Fragen ("welche max. Temperatur hat iglidur G UND welcher
//    Werkstoff sind die Energieketten") ergeben EINEN Vektor, der beide Themen
//    mittelt und dann keines von beiden trifft.
//
// 2. Der Bestand ist überwiegend englisch, gefragt wird deutsch. Die Ähnlichkeit
//    zwischen deutscher Frage und englischem Text ist systematisch niedriger als
//    zwischen deutscher Frage und deutschem Text - unabhängig vom Inhalt. Eine
//    deutsche Frage zieht deshalb deutsche Werbetexte vor den englischen
//    Katalog, der die Antwort enthält.
//
// Deshalb: pro Thema eine ausformulierte Frage in BEIDEN Sprachen. Gesucht wird
// mit allen Varianten, eine Fundstelle zählt mit ihrer besten Übereinstimmung.

const schema = z.object({
  topics: z
    .array(
      z.object({
        de: z.string().describe("Vollständige Frage auf Deutsch"),
        en: z.string().describe("Dieselbe Frage auf Englisch"),
      }),
    )
    .min(1)
    .max(3),
});

export type Topic = string[]; // Formulierungen desselben Themas

export async function planTopics(question: string): Promise<Topic[]> {
  const trimmed = question.trim();
  try {
    const { object } = await generateObject({
      model: getChatModel(),
      schema,
      abortSignal: AbortSignal.timeout(9000),
      prompt: `Bereite die folgende Nutzerfrage für die Suche in einem Produktkatalog auf.

Regeln:
- Zerlege sie in 1-3 Themen. Jedes Thema behandelt GENAU EINE Sache
  (ein Produkt, eine Eigenschaft). Nur ein Thema? Dann nur eines zurückgeben.
- Formuliere jedes Thema als VOLLSTÄNDIGEN, natürlichen Fragesatz,
  einmal auf Deutsch ("de") und einmal auf Englisch ("en").
  Gut: "Aus welchem Werkstoff bestehen die igus Energieketten?" /
       "Which material are igus energy chains made of?"
  Schlecht: "Werkstoff Energieketten"
- Behalte Produktnamen exakt bei (z. B. "iglidur G", "igumid", "E4/light").

Frage: ${trimmed}`,
    });

    const topics = object.topics
      .map(({ de, en }) => [de.trim(), en.trim()].filter((q) => q.length > 2))
      .filter((variants) => variants.length > 0);
    return topics.length ? topics : [[trimmed]];
  } catch {
    return [[trimmed]];
  }
}
