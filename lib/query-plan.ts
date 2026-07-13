import { generateObject } from "ai";
import { z } from "zod";
import { getChatModel } from "@/lib/chat-model";

// Nutzerfragen sind oft mehrteilig ("welche max. Temperatur hat iglidur G UND
// welcher Werkstoff sind die Energieketten"). Ein einziger Frage-Vektor mittelt
// beide Themen und trifft dann keins von beiden richtig: die Suche landet auf
// Seiten, die "irgendwie nach Material und Temperatur aussehen".
//
// Deshalb die Frage in eigenständige Teilfragen zerlegen und für jede getrennt
// suchen. Die Treffer werden anschließend vereinigt.

const schema = z.object({
  queries: z
    .array(z.string())
    .min(1)
    .max(3)
    .describe("Eigenständige Suchanfragen, je ein Thema"),
});

export async function planQueries(question: string): Promise<string[]> {
  const trimmed = question.trim();
  if (trimmed.length < 12) return [trimmed];
  try {
    const { object } = await generateObject({
      model: getChatModel(),
      schema,
      abortSignal: AbortSignal.timeout(8000),
      prompt: `Zerlege die folgende Frage in 1-3 eigenständige Suchanfragen für eine Produktkatalog-Suche.
Regeln:
- Jede Suchanfrage behandelt GENAU EIN Thema (ein Produkt, eine Eigenschaft).
- Behalte Produktnamen und Schreibweisen exakt bei (z. B. "iglidur G", "igumid").
- Keine Füllwörter, keine Rückfragen, nur die Suchanfragen.
- Behandelt die Frage nur ein Thema, gib genau eine Suchanfrage zurück.

Frage: ${trimmed}`,
    });
    const queries = object.queries
      .map((q) => q.trim())
      .filter((q) => q.length > 2);
    return queries.length ? queries : [trimmed];
  } catch {
    return [trimmed];
  }
}
