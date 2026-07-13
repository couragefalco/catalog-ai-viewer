import { streamText, type ModelMessage } from "ai";
import { getChatModel } from "@/lib/chat-model";
import { retrieveCandidates } from "@/lib/global-retrieval";
import type { Citation } from "@/lib/types";

export const maxDuration = 60;
export const runtime = "nodejs";

type InMsg = { role: "user" | "assistant"; text: string };

function createPlainTextProtocolResponse(text: string) {
  return new Response(`${text}\x1e[]`, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}

export async function POST(req: Request) {
  const { messages }: { messages: InMsg[] } = await req.json();
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  if (!lastUser) {
    return createPlainTextProtocolResponse("Stelle eine Frage zu den Katalogen.");
  }

  const candidateChunks = await retrieveCandidates(lastUser.text);
  if (candidateChunks.length === 0) {
    return createPlainTextProtocolResponse(
      "Ich habe dazu keine passende Stelle in den Katalogen gefunden.",
    );
  }

  const candidates = candidateChunks
    .map(
      (c) =>
        `[${c.id}] (${c.catalogName}, Seite ${c.chunk.page}) ${c.chunk.text}`,
    )
    .join("\n");

  const system = `Du bist ein Assistent für mehrere Produktkataloge.
Beantworte Fragen auf Deutsch, präzise und ausschließlich auf Basis der unten aufgeführten Textauszüge.
Wenn etwas nicht in den Auszügen steht, sage das ehrlich.

ZITATE:
- Setze hinter jede Aussage einen Marker im Format [[source-id]].
- Verwende ausschließlich source-ids aus der folgenden Liste.
- Wenn mehrere Kataloge relevant sind, nenne klar, aus welchem Katalog die Aussage stammt.

=== ZITIER-KANDIDATEN ===
${candidates}
=== ENDE ===`;

  const modelMessages: ModelMessage[] = messages.map((m) => ({
    role: m.role,
    content: m.text,
  }));

  let result: ReturnType<typeof streamText>;
  try {
    result = streamText({
      model: getChatModel(),
      system,
      messages: modelMessages,
    });
  } catch (error) {
    console.error("global chat stream setup failed", error);
    return createPlainTextProtocolResponse(
      "Es gab einen Fehler bei der Anfrage.",
    );
  }

  const byId = new Map(candidateChunks.map((c) => [c.id, c]));
  const allowed = new Set(candidateChunks.map((c) => c.id));
  const buildCitations = (text: string): Citation[] => {
    const blocks = text.match(/\[\[[\s\S]*?\]\]/g) ?? [];
    const citedIds = [
      ...new Set(
        blocks
          .flatMap((block) => block.match(/c\d+-p\d+-b\d+/g) ?? [])
          .filter((id) => allowed.has(id)),
      ),
    ].slice(0, 12);

    return citedIds
      .map((id) => {
        const candidate = byId.get(id);
        return candidate
          ? {
              id,
              catalogId: candidate.catalogId,
              catalogName: candidate.catalogName,
              page: candidate.chunk.page,
              bbox: candidate.chunk.bbox,
              snippet: candidate.chunk.text.slice(0, 160),
            }
          : null;
      })
      .filter(Boolean) as Citation[];
  };

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let full = "";
      try {
        for await (const delta of result.textStream) {
          full += delta;
          controller.enqueue(encoder.encode(delta));
        }
        controller.enqueue(
          encoder.encode("\x1e" + JSON.stringify(buildCitations(full))),
        );
      } catch {
        if (!full) {
          controller.enqueue(
            encoder.encode("Es gab einen Fehler bei der Anfrage."),
          );
        }
        controller.enqueue(encoder.encode("\x1e[]"));
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
