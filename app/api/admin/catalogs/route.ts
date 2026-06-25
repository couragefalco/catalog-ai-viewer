import { processCatalogUploadForUser } from "@/lib/catalog-upload";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request) {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) {
    return Response.json({ error: "Nicht autorisiert" }, { status: 401 });
  }
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File) || !file.name.toLowerCase().endsWith(".pdf")) {
    return Response.json({ error: "Bitte eine PDF-Datei hochladen." }, { status: 400 });
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    const upload = await processCatalogUploadForUser({
      user: { id: data.user.id, email: data.user.email },
      bytes,
      filename: file.name,
    });
    if (!upload.ok) {
      return Response.json({ error: upload.error }, { status: upload.status });
    }
    return Response.json(upload.result);
  } catch {
    return Response.json({ error: "PDF konnte nicht verarbeitet werden." }, { status: 422 });
  }
}
