import { requireAdmin } from "@/lib/admin-auth";
import { processUpload } from "@/lib/process-upload";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request) {
  if (!(await requireAdmin())) {
    return Response.json({ error: "Nicht autorisiert" }, { status: 401 });
  }
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File) || !file.name.toLowerCase().endsWith(".pdf")) {
    return Response.json({ error: "Bitte eine PDF-Datei hochladen." }, { status: 400 });
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    const result = await processUpload(bytes, file.name);
    return Response.json(result);
  } catch {
    return Response.json({ error: "PDF konnte nicht verarbeitet werden." }, { status: 422 });
  }
}
