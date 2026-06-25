import { redirect } from "next/navigation";
import { CatalogDashboard } from "@/components/dashboard/catalog-dashboard";
import { getOrCreateWorkspaceForUser, listWorkspaceCatalogs } from "@/lib/account";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");

  const workspace = await getOrCreateWorkspaceForUser({
    id: data.user.id,
    email: data.user.email,
  });
  const catalogs = await listWorkspaceCatalogs(workspace.id);

  return (
    <CatalogDashboard
      currentUserId={data.user.id}
      workspace={workspace}
      catalogs={catalogs}
    />
  );
}
