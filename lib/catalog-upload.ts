import "server-only";

import {
  FREE_QUESTION_LIMIT,
  canUploadCatalog,
  createCatalogEntry,
  getOrCreateWorkspaceForUser,
  listWorkspaceCatalogs,
} from "@/lib/account";
import { processUpload } from "@/lib/process-upload";
import { removeCatalog } from "@/lib/store";

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

export async function processCatalogUploadForUser(input: {
  user: { id: string; email?: string };
  bytes: Uint8Array;
  filename: string;
}): Promise<
  | {
      ok: true;
      result: Awaited<ReturnType<typeof processUpload>> & { catalogEntryId: string };
    }
  | { ok: false; status: 402; error: string }
> {
  const workspace = await getOrCreateWorkspaceForUser({
    id: input.user.id,
    email: input.user.email,
  });
  const existing = await listWorkspaceCatalogs(workspace.id);
  const result = await processUpload(input.bytes, input.filename);
  const allowed = canUploadCatalog({
    plan: workspace.plan,
    existingCatalogs: existing.length,
    pages: result.numPages,
  });
  if (!allowed.ok) {
    await removeCatalog(result.id);
    return {
      ok: false,
      status: 402,
      error:
        allowed.reason === "FREE_PAGE_LIMIT"
          ? "Der kostenlose Plan erlaubt Kataloge bis 20 Seiten."
          : "Der kostenlose Plan erlaubt einen Katalog.",
    };
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

  return { ok: true, result: { ...result, catalogEntryId: entry.id } };
}
