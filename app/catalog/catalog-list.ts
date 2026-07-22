import type { Catalog } from "@/components/catalog-viewer";
import { listCatalogs } from "@/lib/store";

const rank = (catalog: { id: string; numPages: number }) =>
  catalog.numPages === 8 && /kompaktkatalog/i.test(catalog.id)
    ? 0
    : /kompaktkatalog/i.test(catalog.id)
      ? 1
      : 2;

export async function getOrderedClientCatalogs(): Promise<Catalog[]> {
  const catalogs = await listCatalogs();
  return [...catalogs]
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
    .map((catalog) => ({
      id: catalog.id,
      name: catalog.name,
      numPages: catalog.numPages,
      file: `/api/catalog/${catalog.id}/pdf`,
      category: catalog.category,
      exampleQuestions: catalog.exampleQuestions,
    }));
}
