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
import { canAskQuestion, type WorkspacePlan } from "./account-limits";

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

export async function getOwnedCatalogEntry(
  blobCatalogId: string,
  userId: string,
): Promise<CatalogEntry | null> {
  const workspace = await getOrCreateWorkspaceForUser({ id: userId });
  const supabase = createSupabaseAdminClient();
  const res = await supabase
    .from("catalog_entries")
    .select("*")
    .eq("workspace_id", workspace.id)
    .eq("blob_catalog_id", blobCatalogId)
    .maybeSingle();
  if (res.error) throw res.error;
  return (res.data as CatalogEntry | null) ?? null;
}

export async function incrementQuestionCount(
  blobCatalogId: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const supabase = createSupabaseAdminClient();
  const current = await supabase
    .from("catalog_entries")
    .select("id, question_count, question_limit, workspace_id, workspaces(plan)")
    .eq("blob_catalog_id", blobCatalogId)
    .maybeSingle();
  if (current.error) throw current.error;
  if (!current.data) return { ok: true };

  const row = current.data as {
    id: string;
    question_count: number;
    workspaces: { plan: WorkspacePlan } | { plan: WorkspacePlan }[] | null;
  };
  const workspace = Array.isArray(row.workspaces)
    ? row.workspaces[0]
    : row.workspaces;
  const allowed = canAskQuestion({
    plan: workspace?.plan ?? "free",
    questionCount: row.question_count,
  });
  if (!allowed.ok) return allowed;

  const updated = await supabase
    .from("catalog_entries")
    .update({ question_count: row.question_count + 1 })
    .eq("id", row.id);
  if (updated.error) throw updated.error;
  return { ok: true };
}
