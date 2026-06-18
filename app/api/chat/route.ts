import { google } from "@ai-sdk/google";
import { streamText, type ModelMessage } from "ai";
import { getCatalog, getCatalogPdfBytes } from "@/lib/store";
import type { Citation } from "@/lib/types";

export const maxDuration = 60;
export const runtime = "nodejs";

type InMsg = { role: "user" | "assistant"; text: string };

export async function POST(req: Request) {
  const { messages, docId }: { messages: InMsg[]; docId: string } =
    await req.json();

  const catalog = await getCatalog(docId);
  if (!catalog) {
    return Response.json({ text: "Unbekanntes Dokument.", citations: [] });
  }
  const chunks = catalog.chunks;

  // Read the full PDF from Blob so Gemini reads it natively (incl. tables).
  const pdfBytes = await getCatalogPdfBytes(docId);

  const candidates = chunks
    .map((c) => `[${c.id}] (Seite ${c.page}) ${c.text}`)
    .join("\n");

  const notesBlock = catalog.notes?.trim()
    ? `\n\nZUSÄTZLICHER KONTEXT (vom Betreiber gepflegt, beachte ihn):\n${catalog.notes.trim()}\n`
    : "";

  const system = `Du bist ein Assistent für genau ein PDF: "${catalog.name}".
Das vollständige PDF ist angehängt — lies es direkt und vollständig, inklusive Tabellen, Maße und Spalten. Gib Tabellen bei Bedarf als Markdown-Tabelle aus.
Antworte auf Deutsch, präzise. Wenn etwas nicht im Dokument steht, sage das ehrlich.${notesBlock}

ZITATE:
- Setze hinter jede Aussage einen Marker im Format [[chunk-id]] (genau EINE id pro Klammerpaar).
- Mehrere Quellen: mehrere Marker direkt hintereinander, z. B. [[p5-b1]][[p5-b3]]. Fasse NIEMALS mehrere ids in ein Klammerpaar zusammen (kein [[p5-b1, p5-b3]]).
- Verwende AUSSCHLIESSLICH chunk-ids aus der folgenden Liste. Erfinde keine. Wähle den Chunk, dessen Seite/Inhalt am besten zu deiner Aussage passt.

=== ZITIER-KANDIDATEN ===
${candidates}
=== ENDE ===`;

  // Build model messages; attach the PDF to the latest user turn.
  const modelMessages: ModelMessage[] = messages.map((m, i) => {
    const isLastUser = i === messages.length - 1 && m.role === "user";
    if (isLastUser && pdfBytes) {
      return {
        role: "user",
        content: [
          { type: "text", text: m.text },
          { type: "file", data: pdfBytes, mediaType: "application/pdf" },
        ],
      };
    }
    return { role: m.role, content: m.text };
  });

  const result = streamText({
    model: google("gemini-2.5-flash"),
    system,
    messages: modelMessages,
  });

  // Resolve cited ids -> page + bbox from the COMPLETE text (citations need the
  // whole answer, so they're computed once the stream ends). Robust to whatever
  // bracket form Gemini emits ([[id]], [[id1]][[id2]], or [[id1], [id2]]).
  const byId = new Map(chunks.map((c) => [c.id, c]));
  const allowed = new Set(chunks.map((c) => c.id));
  const buildCitations = (text: string): Citation[] => {
    const blocks = text.match(/\[\[[\s\S]*?\]\]/g) ?? [];
    const citedIds = [
      ...new Set(
        blocks
          .flatMap((b) => b.match(/p\d+-b\d+/g) ?? [])
          .filter((id) => allowed.has(id)),
      ),
    ].slice(0, 12); // keep the sources list usable (order = first appearance)
    return citedIds
      .map((id) => {
        const chunk = byId.get(id);
        return chunk
          ? {
              id,
              page: chunk.page,
              bbox: chunk.bbox,
              snippet: chunk.text.slice(0, 160),
            }
          : null;
      })
      .filter(Boolean) as Citation[];
  };

  // Stream the answer text live, then append the citations JSON after a record
  // separator (\x1e never appears in German answer text). The client splits on
  // it: everything before is the live text, everything after is the sources.
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
