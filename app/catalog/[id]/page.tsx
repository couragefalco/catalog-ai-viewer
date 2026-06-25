import { notFound } from "next/navigation";
import { getCatalog } from "@/lib/store";
import { CatalogWorkspace } from "@/components/catalog-workspace";

export default async function CatalogPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const catalog = await getCatalog(id);
  if (!catalog) notFound();

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
