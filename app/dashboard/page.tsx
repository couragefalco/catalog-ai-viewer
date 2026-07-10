import { redirect } from "next/navigation";
import { CatalogDashboard } from "@/components/dashboard/catalog-dashboard";
import { getOrCreateWorkspaceForUser, listWorkspaceCatalogs } from "@/lib/account";
import { listShareLinks } from "@/lib/share-links";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getOrderedClientCatalogs } from "@/app/catalog/catalog-list";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");

  const workspace = await getOrCreateWorkspaceForUser({
    id: data.user.id,
    email: data.user.email,
  });
  const [catalogs, allCatalogs, shareLinks] = await Promise.all([
    listWorkspaceCatalogs(workspace.id),
    getOrderedClientCatalogs(),
    listShareLinks(),
  ]);

  return (
    <CatalogDashboard
      currentUserId={data.user.id}
      workspace={workspace}
      catalogs={catalogs}
      allCatalogs={allCatalogs}
      shareLinks={shareLinks}
    />
  );
}
