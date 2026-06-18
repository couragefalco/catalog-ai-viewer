import { google } from "@ai-sdk/google";
import { generateObject } from "ai";
import { z } from "zod";

const schema = z.object({
  name: z.string(),
  notes: z.string(),
  exampleQuestions: z.array(z.string()).max(5),
});

export async function enrichCatalog(input: {
  fallbackName: string;
  sampleText: string;
}): Promise<{ name: string; notes: string; exampleQuestions: string[] }> {
  try {
    const { object } = await generateObject({
      model: google("gemini-2.5-flash"),
      schema,
      abortSignal: AbortSignal.timeout(20000),
      prompt: `Du erhältst Auszüge aus einem Produktkatalog/Whitepaper (Deutsch).
Erzeuge als ENTWURF (ein Mensch prüft danach):
- "name": ein kurzer, sauberer Katalogname.
- "notes": Hinweise für eine KI-Suche, z. B. Produktnamen-Varianten oder Schreibweisen, die als gleichwertig gelten sollen.
- "exampleQuestions": bis zu 5 typische Nutzerfragen.

Auszug:
${input.sampleText.slice(0, 6000)}`,
    });
    return {
      name: object.name?.trim() || input.fallbackName,
      notes: object.notes?.trim() ?? "",
      exampleQuestions: object.exampleQuestions ?? [],
    };
  } catch {
    return { name: input.fallbackName, notes: "", exampleQuestions: [] };
  }
}
