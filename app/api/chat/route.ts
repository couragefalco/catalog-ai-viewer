import { streamText, type ModelMessage } from "ai";
import { getChatModel } from "@/lib/chat-model";
import { incrementQuestionCount } from "@/lib/account";
import { getCatalog, getCatalogPdfBytes, getCatalogVectors } from "@/lib/store";
import { embedQuery, topKIndices } from "@/lib/embeddings";
import { ASSET_PATH } from "@/lib/base-path";
import type { Citation } from "@/lib/types";

export const maxDuration = 60;
export const runtime = "nodejs";

type InMsg = { role: "user" | "assistant"; text: string };

function summarizeError(error: unknown) {
  if (error instanceof Error) return error.message.slice(0, 240);
  if (typeof error === "object" && error && "message" in error) {
    return String(error.message).slice(0, 240);
  }
  return String(error).slice(0, 240);
}

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
  const { messages, docId }: { messages: InMsg[]; docId: string } =
    await req.json();

  const catalog = await getCatalog(docId);
  if (!catalog) {
    return Response.json({ text: "Unbekanntes Dokument.", citations: [] });
  }

  const usage = await incrementQuestionCount(docId).catch((error: unknown) => {
    console.warn("question count unavailable", summarizeError(error));
    return { ok: true as const };
  });
  if (!usage.ok) {
    return createPlainTextProtocolResponse(
      "Das kostenlose Fragenlimit für diesen Katalog ist erreicht.",
    );
  }

  const chunks = catalog.chunks;

  // Determine retrieval mode: rag (large catalogs) vs full (small, default).
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  let candidateChunks = chunks;
  let attachPdf = true;

  if (catalog.mode === "rag" && lastUser) {
    const vectors = await getCatalogVectors(docId);
    if (vectors && vectors.length === chunks.length) {
      const q = await embedQuery(lastUser.text);
      const idx = topKIndices(q, vectors, 16);
      candidateChunks = idx.map((i) => chunks[i]);
      attachPdf = false; // do NOT send the whole (huge) PDF
    }
    // If vectors missing or mismatched, fall back to full behavior (attachPdf stays true, candidateChunks stays chunks).
  }

  // Read the full PDF from Blob only when needed (full mode).
  const pdfBytes = attachPdf ? await getCatalogPdfBytes(docId) : null;

  const candidates = candidateChunks
    .map((c) => `[${c.id}] (Seite ${c.page}) ${c.text}`)
    .join("\n");

  const notesBlock = catalog.notes?.trim()
    ? `\n\nZUSÄTZLICHER KONTEXT (vom Betreiber gepflegt, beachte ihn):\n${catalog.notes.trim()}\n`
    : "";

  // Optionale, pro Katalog gepflegte Verhaltensvorgaben (z. B. Landingpage-
  // Verkaufslogik). Nur hier im Dokument-Chat aktiv, damit die übrigen Kataloge
  // und die globale Suche neutral bleiben. Der In-App-Download-Link zum PDF wird
  // serverseitig gesetzt, damit er über den /catalog-Proxy überall auflöst.
  const whitepaperUrl = `${ASSET_PATH}/api/catalog/${docId}/pdf`;
  const agentBlock = catalog.agentInstructions?.trim()
    ? `\n\nVERHALTENSVORGABEN (vom Betreiber, strikt befolgen):\n${catalog.agentInstructions.trim()}\n\nDOWNLOAD-LINK ZUM DOKUMENT (biete ihn als Markdown-Link an, z. B. [Whitepaper herunterladen](${whitepaperUrl}), und verwende exakt diese URL, erfinde keine andere):\n${whitepaperUrl}\n`
    : "";

  const ragOnlyInstruction = attachPdf
    ? ""
    : "\nBeantworte die Frage AUSSCHLIESSLICH auf Basis der unten aufgeführten Textauszüge und zitiere deren [[chunk-id]].";

  const system = attachPdf
    ? `Du bist ein Assistent für genau ein PDF: "${catalog.name}".
Das vollständige PDF ist angehängt — lies es direkt und vollständig, inklusive Tabellen, Maße und Spalten. Gib Tabellen bei Bedarf als Markdown-Tabelle aus.
Antworte auf Deutsch, präzise. Wenn etwas nicht im Dokument steht, sage das ehrlich.${notesBlock}${agentBlock}

ZITATE:
- Setze hinter jede Aussage einen Marker im Format [[chunk-id]] (genau EINE id pro Klammerpaar).
- Mehrere Quellen: mehrere Marker direkt hintereinander, z. B. [[p5-b1]][[p5-b3]]. Fasse NIEMALS mehrere ids in ein Klammerpaar zusammen (kein [[p5-b1, p5-b3]]).
- Verwende AUSSCHLIESSLICH chunk-ids aus der folgenden Liste. Erfinde keine. Wähle den Chunk, dessen Seite/Inhalt am besten zu deiner Aussage passt.

=== ZITIER-KANDIDATEN ===
${candidates}
=== ENDE ===`
    : `Du bist ein Assistent für genau ein PDF: "${catalog.name}".${ragOnlyInstruction}
Antworte auf Deutsch, präzise. Wenn etwas nicht in den Auszügen steht, sage das ehrlich.${notesBlock}${agentBlock}

ZITATE:
- Setze hinter jede Aussage einen Marker im Format [[chunk-id]] (genau EINE id pro Klammerpaar).
- Mehrere Quellen: mehrere Marker direkt hintereinander, z. B. [[p5-b1]][[p5-b3]]. Fasse NIEMALS mehrere ids in ein Klammerpaar zusammen (kein [[p5-b1, p5-b3]]).
- Verwende AUSSCHLIESSLICH chunk-ids aus der folgenden Liste. Erfinde keine. Wähle den Chunk, dessen Seite/Inhalt am besten zu deiner Aussage passt.

=== ZITIER-KANDIDATEN ===
${candidates}
=== ENDE ===`;

  // Build model messages; attach the PDF to the latest user turn (full mode only).
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

  let result: ReturnType<typeof streamText>;
  try {
    result = streamText({
      model: getChatModel(),
      system,
      messages: modelMessages,
    });
  } catch (error) {
    console.error("chat stream setup failed", error);
    return createPlainTextProtocolResponse(
      "Es gab einen Fehler bei der Anfrage.",
    );
  }

  // Resolve cited ids -> page + bbox from the COMPLETE text (citations need the
  // whole answer, so they're computed once the stream ends). Robust to whatever
  // bracket form Gemini emits ([[id]], [[id1]][[id2]], or [[id1], [id2]]).
  // Use candidateChunks so every id Gemini emits is resolvable in both modes.
  const byId = new Map(candidateChunks.map((c) => [c.id, c]));
  const allowed = new Set(candidateChunks.map((c) => c.id));
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
