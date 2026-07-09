import { CatalogBrowser } from "@/components/catalog-browser";
import { CatalogWorkspace } from "@/components/catalog-workspace";
import { getCatalog } from "@/lib/store";
import { getOrderedClientCatalogs } from "../catalog-list";

export default async function CatalogPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const catalog = await getCatalog(id);
  if (!catalog) {
    const catalogs = await getOrderedClientCatalogs();
    return <CatalogBrowser catalogs={catalogs} />;
  }

  return (
    <CatalogWorkspace
      catalog={{
        id: catalog.id,
        name: catalog.name,
        numPages: catalog.numPages,
        file: `/api/catalog/${catalog.id}/pdf`,
      }}
    />
  );
}
