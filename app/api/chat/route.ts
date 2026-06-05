import { google } from "@ai-sdk/google";
import { generateText, type ModelMessage } from "ai";
import { CATALOGS } from "@/lib/catalogs";
import { CHUNKS_BY_DOC } from "@/lib/chunks-data";
import { resolveChunk } from "@/lib/retrieval";
import { BASE_PATH } from "@/lib/base-path";
import type { Citation } from "@/lib/types";

export const maxDuration = 60;

type InMsg = { role: "user" | "assistant"; text: string };

export async function POST(req: Request) {
  const {
    messages,
    docId,
  }: { messages: InMsg[]; docId: string } = await req.json();

  const catalog = CATALOGS.find((c) => c.id === docId);
  const chunks = CHUNKS_BY_DOC[docId] ?? [];
  if (!catalog) {
    return Response.json({ text: "Unbekanntes Dokument.", citations: [] });
  }

  // Fetch the full PDF so Gemini reads it natively (nothing lost — incl. tables).
  let pdfBytes: Uint8Array | null = null;
  try {
    const origin = new URL(req.url).origin;
    const res = await fetch(`${origin}${BASE_PATH}/${catalog.file}`);
    if (res.ok) pdfBytes = new Uint8Array(await res.arrayBuffer());
  } catch {
    pdfBytes = null;
  }

  // Citation candidates: every chunk id + page + text (used only for [[id]] grounding).
  const candidates = chunks
    .map((c) => `[${c.id}] (Seite ${c.page}) ${c.text}`)
    .join("\n");

  const system = `Du bist ein Assistent für genau ein PDF: "${catalog.name}".
Das vollständige PDF ist angehängt — lies es direkt und vollständig, inklusive Tabellen, Maße und Spalten. Gib Tabellen bei Bedarf als Markdown-Tabelle aus.
Antworte auf Deutsch, präzise. Wenn etwas nicht im Dokument steht, sage das ehrlich.

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

  const { text } = await generateText({
    model: google("gemini-2.5-flash"),
    system,
    messages: modelMessages,
  });

  // Resolve cited ids → page + bbox (server-side; client never loads chunks).
  // Robust to whatever bracket form Gemini emits ([[id]], [[id1]][[id2]],
  // or [[id1], [id2]]): pull every chunk-id token out of each [[ … ]] block.
  const allowed = new Set(chunks.map((c) => c.id));
  const blocks = text.match(/\[\[[\s\S]*?\]\]/g) ?? [];
  const citedIds = [
    ...new Set(
      blocks
        .flatMap((b) => b.match(/p\d+-b\d+/g) ?? [])
        .filter((id) => allowed.has(id)),
    ),
  ].slice(0, 12); // keep the sources list usable (order = first appearance)
  const citations: Citation[] = citedIds
    .map((id) => {
      const chunk = resolveChunk(docId, id);
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

  return Response.json({ text, citations });
}
