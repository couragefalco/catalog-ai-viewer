import { getOwnedCatalogEntry } from "@/lib/account";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { patchCatalog, removeCatalog } from "@/lib/store";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) {
    return Response.json({ error: "Nicht autorisiert" }, { status: 401 });
  }
  const { id } = await params;
  const owned = await getOwnedCatalogEntry(id, data.user.id);
  if (!owned) {
    return Response.json({ error: "Nicht gefunden" }, { status: 404 });
  }
  const body = (await req.json()) as {
    name?: string;
    notes?: string;
    exampleQuestions?: string[];
  };
  const updated = await patchCatalog(id, body);
  if (!updated) return Response.json({ error: "Nicht gefunden" }, { status: 404 });
  return Response.json({ ok: true });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) {
    return Response.json({ error: "Nicht autorisiert" }, { status: 401 });
  }
  const { id } = await params;
  const owned = await getOwnedCatalogEntry(id, data.user.id);
  if (!owned) {
    return Response.json({ error: "Nicht gefunden" }, { status: 404 });
  }
  await removeCatalog(id);
  return Response.json({ ok: true });
}
