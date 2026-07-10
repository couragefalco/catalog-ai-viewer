import { getAdminUserId } from "@/lib/admin-access";
import { getCatalog } from "@/lib/store";
import { listShareLinks, saveShareLink } from "@/lib/share-links";

export const runtime = "nodejs";

export async function GET() {
  const userId = await getAdminUserId();
  if (!userId) {
    return Response.json({ error: "Nicht autorisiert" }, { status: 401 });
  }
  return Response.json({ links: await listShareLinks() });
}

export async function POST(req: Request) {
  const userId = await getAdminUserId();
  if (!userId) {
    return Response.json({ error: "Nicht autorisiert" }, { status: 401 });
  }

  const body = (await req.json()) as {
    slug?: string;
    name?: string;
    catalogId?: string;
    mode?: "document" | "global";
  };

  if (!body.slug || !body.catalogId) {
    return Response.json(
      { error: "Slug und Katalog sind erforderlich." },
      { status: 400 },
    );
  }

  const catalog = await getCatalog(body.catalogId);
  if (!catalog) {
    return Response.json({ error: "Katalog nicht gefunden." }, { status: 404 });
  }

  try {
    const link = await saveShareLink({
      slug: body.slug,
      name: body.name ?? body.slug,
      catalogId: body.catalogId,
      mode: body.mode === "global" ? "global" : "document",
      createdBy: userId,
    });
    return Response.json({ link });
  } catch {
    return Response.json({ error: "Share-Link ungültig." }, { status: 400 });
  }
}
