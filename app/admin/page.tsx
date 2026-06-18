import { requireAdmin } from "@/lib/admin-auth";
import { listCatalogs } from "@/lib/store";
import { AdminDashboard, AdminLogin } from "@/components/admin-dashboard";

export default async function AdminPage() {
  if (!(await requireAdmin())) return <AdminLogin />;
  const catalogs = await listCatalogs();
  return <AdminDashboard catalogs={catalogs} />;
}
