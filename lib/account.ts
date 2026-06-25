import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
export {
  FREE_CATALOG_LIMIT,
  FREE_PAGE_LIMIT,
  FREE_QUESTION_LIMIT,
  canAskQuestion,
  canUploadCatalog,
} from "./account-limits";
export type { WorkspacePlan } from "./account-limits";
import type { WorkspacePlan } from "./account-limits";

export type Workspace = {
  id: string;
  name: string;
  owner_user_id: string;
  plan: WorkspacePlan;
  subscription_status: string;
  custom_domain: string | null;
  logo_blob_path: string | null;
  primary_color: string | null;
};

export type CatalogEntry = {
  id: string;
  workspace_id: string;
  blob_catalog_id: string;
  name: string;
  slug: string;
  description: string;
  notes: string;
  example_questions: string[];
  num_pages: number;
  mode: "full" | "rag";
  status: "processing" | "ready" | "failed";
  question_limit: number;
  question_count: number;
};

export async function getOrCreateWorkspaceForUser(user: {
  id: string;
  email?: string;
}): Promise<Workspace> {
  const supabase = createSupabaseAdminClient();
  const existing = await supabase
    .from("workspace_members")
    .select("workspaces(*)")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  if (existing.error) throw existing.error;

  const row = existing.data as { workspaces: Workspace | Workspace[] | null } | null;
  const workspace = Array.isArray(row?.workspaces)
    ? row.workspaces[0]
    : row?.workspaces;
  if (workspace) return workspace;

  const name = user.email ? user.email.split("@")[0] : "Workspace";
  const created = await supabase
    .from("workspaces")
    .insert({ name, owner_user_id: user.id })
    .select("*")
    .single();
  if (created.error) throw created.error;

  const membership = await supabase.from("workspace_members").insert({
    workspace_id: created.data.id,
    user_id: user.id,
    role: "owner",
  });
  if (membership.error) throw membership.error;

  return created.data as Workspace;
}

export async function listWorkspaceCatalogs(
  workspaceId: string,
): Promise<CatalogEntry[]> {
  const supabase = createSupabaseAdminClient();
  const res = await supabase
    .from("catalog_entries")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false });
  if (res.error) throw res.error;
  return (res.data ?? []) as CatalogEntry[];
}

export async function createCatalogEntry(input: {
  workspaceId: string;
  blobCatalogId: string;
  name: string;
  slug: string;
  description?: string;
  notes: string;
  exampleQuestions: string[];
  numPages: number;
  mode: "full" | "rag";
  questionLimit: number;
}): Promise<CatalogEntry> {
  const supabase = createSupabaseAdminClient();
  const res = await supabase
    .from("catalog_entries")
    .insert({
      workspace_id: input.workspaceId,
      blob_catalog_id: input.blobCatalogId,
      name: input.name,
      slug: input.slug,
      description: input.description ?? "",
      notes: input.notes,
      example_questions: input.exampleQuestions,
      num_pages: input.numPages,
      mode: input.mode,
      question_limit: input.questionLimit,
    })
    .select("*")
    .single();
  if (res.error) throw res.error;
  return res.data as CatalogEntry;
}

export async function getCatalogEntryForMember(
  blobCatalogId: string,
  userId: string,
): Promise<CatalogEntry | null> {
  const supabase = createSupabaseAdminClient();
  const catalog = await supabase
    .from("catalog_entries")
    .select("*")
    .eq("blob_catalog_id", blobCatalogId)
    .maybeSingle();
  if (catalog.error) throw catalog.error;
  if (!catalog.data) return null;

  const membership = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("workspace_id", catalog.data.workspace_id)
    .eq("user_id", userId)
    .maybeSingle();
  if (membership.error) throw membership.error;
  if (!membership.data) return null;

  return catalog.data as CatalogEntry;
}

export async function getOwnedCatalogEntry(
  blobCatalogId: string,
  userId: string,
): Promise<CatalogEntry | null> {
  const supabase = createSupabaseAdminClient();
  const catalog = await supabase
    .from("catalog_entries")
    .select("*")
    .eq("blob_catalog_id", blobCatalogId)
    .maybeSingle();
  if (catalog.error) throw catalog.error;
  if (!catalog.data) return null;

  const workspace = await supabase
    .from("workspaces")
    .select("id")
    .eq("id", catalog.data.workspace_id)
    .eq("owner_user_id", userId)
    .maybeSingle();
  if (workspace.error) throw workspace.error;
  if (!workspace.data) return null;

  return catalog.data as CatalogEntry;
}

export async function deleteCatalogEntryForOwner(
  blobCatalogId: string,
  userId: string,
): Promise<boolean> {
  const owned = await getOwnedCatalogEntry(blobCatalogId, userId);
  if (!owned) return false;

  const supabase = createSupabaseAdminClient();
  const deleted = await supabase
    .from("catalog_entries")
    .delete()
    .eq("blob_catalog_id", blobCatalogId)
    .eq("workspace_id", owned.workspace_id);
  if (deleted.error) throw deleted.error;
  return true;
}

export async function incrementQuestionCount(
  blobCatalogId: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const supabase = createSupabaseAdminClient();
  const result = await supabase
    .rpc("increment_question_count_if_allowed", {
      input_blob_catalog_id: blobCatalogId,
    })
    .maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) return { ok: true };

  const row = result.data as { ok: boolean; reason: string | null };
  if (!row.ok) {
    return { ok: false, reason: row.reason ?? "FREE_QUESTION_LIMIT" };
  }

  return { ok: true };
}
