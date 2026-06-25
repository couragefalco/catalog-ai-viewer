import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { pendingUploadPrefix } from "@/lib/pending-upload";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

async function requireUser() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  return data.user;
}

export async function POST(req: Request): Promise<Response> {
  const body = (await req.json()) as HandleUploadBody;
  try {
    const json = await handleUpload({
      request: req,
      body,
      onBeforeGenerateToken: async (pathname) => {
        const user = await requireUser();
        if (!user) throw new Error("Nicht autorisiert");
        if (!pathname.startsWith(pendingUploadPrefix(user.id))) {
          throw new Error("Ungültiger Upload-Pfad.");
        }
        return {
          addRandomSuffix: true,
          allowedContentTypes: ["application/pdf"],
          maximumSizeInBytes: 200 * 1024 * 1024,
        };
      },
      onUploadCompleted: async () => {},
    });
    return Response.json(json);
  } catch (e) {
    return Response.json(
      { error: (e as Error).message || "Upload nicht autorisiert" },
      { status: 401 },
    );
  }
}
