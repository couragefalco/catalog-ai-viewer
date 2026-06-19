import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { requireAdmin } from "@/lib/admin-auth";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  const body = (await req.json()) as HandleUploadBody;
  try {
    const json = await handleUpload({
      request: req,
      body,
      onBeforeGenerateToken: async () => {
        if (!(await requireAdmin())) throw new Error("Nicht autorisiert");
        return {
          addRandomSuffix: true,
          allowedContentTypes: ["application/pdf"],
          maximumSizeInBytes: 200 * 1024 * 1024, // 200 MB
        };
      },
      onUploadCompleted: async () => {
        // Ingest wird vom Client via /api/admin/ingest ausgeloest; hier nichts zu tun.
      },
    });
    return Response.json(json);
  } catch (e) {
    return Response.json(
      { error: (e as Error).message || "Upload nicht autorisiert" },
      { status: 401 },
    );
  }
}
