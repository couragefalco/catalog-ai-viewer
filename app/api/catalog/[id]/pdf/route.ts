import {
  getCatalog,
  getCatalogCoverPdfStream,
  getCatalogPdfStream,
} from "@/lib/store";

export const runtime = "nodejs";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const preview = new URL(req.url).searchParams.get("preview") === "1";

  // Teaser-Kataloge (coverOnly): nur die Deckblatt-Vorschau ausliefern und das
  // volle PDF gar nicht öffentlich zugänglich machen (sonst keine Lead-Gen).
  if (preview) {
    const stream = await getCatalogCoverPdfStream(id);
    if (!stream) return new Response("Not found", { status: 404 });
    return new Response(stream, {
      headers: {
        "Content-Type": "application/pdf",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, max-age=300",
      },
    });
  }

  const meta = await getCatalog(id);
  if (meta?.coverOnly) {
    // Volles PDF ist gesperrt; nur die Vorschau ist erlaubt.
    return new Response("Not found", { status: 404 });
  }

  const stream = await getCatalogPdfStream(id);
  if (!stream) return new Response("Not found", { status: 404 });
  return new Response(stream, {
    headers: {
      "Content-Type": "application/pdf",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=300",
    },
  });
}
