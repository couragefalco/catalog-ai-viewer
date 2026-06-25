import {
  FREE_QUESTION_LIMIT,
  canUploadCatalog,
  createCatalogEntry,
  getOrCreateWorkspaceForUser,
  listWorkspaceCatalogs,
} from "@/lib/account";
import { getBlobBytes, removeBlob, removeCatalog } from "@/lib/store";
import { processUpload } from "@/lib/process-upload";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 300;

function slugFromName(name: string) {
  return (
    name
      .toLowerCase()
      .replace(/\.pdf$/i, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "catalog"
  );
}

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
  const bytes = await getBlobBytes(pathname);
  if (!bytes) {
    return Response.json({ error: "Hochgeladene Datei nicht gefunden." }, { status: 404 });
  }

  let catalogId: string | null = null;
  try {
    const workspace = await getOrCreateWorkspaceForUser({
      id: data.user.id,
      email: data.user.email,
    });
    const existing = await listWorkspaceCatalogs(workspace.id);
    const result = await processUpload(bytes, filename);
    catalogId = result.id;
    const allowed = canUploadCatalog({
      plan: workspace.plan,
      existingCatalogs: existing.length,
      pages: result.numPages,
    });
    if (!allowed.ok) {
      await removeBlob(pathname);
      await removeCatalog(result.id);
      return Response.json(
        {
          error:
            allowed.reason === "FREE_PAGE_LIMIT"
              ? "Der kostenlose Plan erlaubt Kataloge bis 20 Seiten."
              : "Der kostenlose Plan erlaubt einen Katalog.",
        },
        { status: 402 },
      );
    }

    const entry = await createCatalogEntry({
      workspaceId: workspace.id,
      blobCatalogId: result.id,
      name: result.name,
      slug: slugFromName(result.name),
      notes: result.notes,
      exampleQuestions: result.exampleQuestions,
      numPages: result.numPages,
      mode: result.mode,
      questionLimit: workspace.plan === "free" ? FREE_QUESTION_LIMIT : 1000,
    });
    await removeBlob(pathname);
    return Response.json({ ...result, catalogEntryId: entry.id });
  } catch {
    await removeBlob(pathname).catch(() => undefined);
    if (catalogId) {
      await removeCatalog(catalogId).catch(() => undefined);
    }
    return Response.json({ error: "PDF konnte nicht verarbeitet werden." }, { status: 422 });
  }
}
