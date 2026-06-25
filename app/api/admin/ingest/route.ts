import { processCatalogUploadForUser } from "@/lib/catalog-upload";
import { pendingUploadPrefix } from "@/lib/pending-upload";
import { getBlobBytes, removeBlob } from "@/lib/store";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request) {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) {
    return Response.json({ error: "Nicht autorisiert" }, { status: 401 });
  }

  const { pathname, filename } = (await req.json()) as {
    pathname?: string;
    filename?: string;
  };
  if (!pathname || !filename) {
    return Response.json({ error: "pathname und filename erforderlich" }, { status: 400 });
  }
  if (!pathname.startsWith(pendingUploadPrefix(data.user.id))) {
    return Response.json({ error: "Ungültiger Upload-Pfad." }, { status: 403 });
  }
  const bytes = await getBlobBytes(pathname);
  if (!bytes) {
    return Response.json({ error: "Hochgeladene Datei nicht gefunden." }, { status: 404 });
  }

  try {
    const upload = await processCatalogUploadForUser({
      user: { id: data.user.id, email: data.user.email },
      bytes,
      filename,
    });
    if (!upload.ok) {
      await removeBlob(pathname);
      return Response.json({ error: upload.error }, { status: upload.status });
    }

    await removeBlob(pathname);
    return Response.json(upload.result);
  } catch {
    return Response.json({ error: "PDF konnte nicht verarbeitet werden." }, { status: 422 });
  }
}
