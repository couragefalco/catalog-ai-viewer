import { getAdminUserId } from "@/lib/admin-access";
import { removeShareLink } from "@/lib/share-links";

export const runtime = "nodejs";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const userId = await getAdminUserId();
  if (!userId) {
    return Response.json({ error: "Nicht autorisiert" }, { status: 401 });
  }
  const { slug } = await params;
  await removeShareLink(slug);
  return Response.json({ ok: true });
}
