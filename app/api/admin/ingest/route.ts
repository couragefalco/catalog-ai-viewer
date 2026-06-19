import { requireAdmin } from "@/lib/admin-auth";
import { getBlobBytes, removeBlob } from "@/lib/store";
import { processUpload } from "@/lib/process-upload";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request) {
  if (!(await requireAdmin())) {
    return Response.json({ error: "Nicht autorisiert" }, { status: 401 });
  }
  const { pathname, filename } = (await req.json()) as {
    pathname?: string;
    filename?: string;
  };
  if (!pathname || !filename) {
    return Response.json({ error: "pathname und filename erforderlich" }, { status: 400 });
  }
  const bytes = await getBlobBytes(pathname);
  if (!bytes) {
    return Response.json({ error: "Hochgeladene Datei nicht gefunden." }, { status: 404 });
  }
  try {
    const result = await processUpload(bytes, filename);
    await removeBlob(pathname); // aufraeumen nach dem Verarbeiten
    return Response.json(result);
  } catch {
    return Response.json({ error: "PDF konnte nicht verarbeitet werden." }, { status: 422 });
  }
}
