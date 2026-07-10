import { AdminDashboard, AdminLogin } from "@/components/admin-dashboard";
import { getOrderedClientCatalogs } from "@/app/catalog/catalog-list";
import { requireAdmin } from "@/lib/admin-auth";
import { listShareLinks } from "@/lib/share-links";
import { listCatalogs } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const isAdmin = await requireAdmin();
  if (!isAdmin) return <AdminLogin />;

  const [catalogs, allCatalogs, shareLinks] = await Promise.all([
    listCatalogs(),
    getOrderedClientCatalogs(),
    listShareLinks(),
  ]);

  return (
    <AdminDashboard
      catalogs={catalogs}
      allCatalogs={allCatalogs}
      shareLinks={shareLinks}
    />
  );
}
