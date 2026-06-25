import Link from "next/link";
import { CatalogBrowser } from "@/components/catalog-browser";
import { listCatalogs } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function IgusCatalogPage() {
  const catalogs = await listCatalogs();

  if (catalogs.length === 0) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-16">
        <img src="/igus-logo.svg" alt="igus" className="mb-4 h-5 w-auto" />
        <h1 className="text-2xl font-semibold">Katalog-Assistent</h1>
        <p className="text-muted-foreground mt-4 text-sm">
          Noch keine Kataloge. Lade im{" "}
          <Link href="/admin" className="underline">
            Admin-Bereich
          </Link>{" "}
          einen hoch.
        </p>
      </main>
    );
  }

  const rank = (catalog: { id: string; numPages: number }) =>
    catalog.numPages === 8 && /kompaktkatalog/i.test(catalog.id)
      ? 0
      : /kompaktkatalog/i.test(catalog.id)
        ? 1
        : 2;

  const ordered = [...catalogs].sort(
    (a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name),
  );

  const clientCatalogs = ordered.map((catalog) => ({
    id: catalog.id,
    name: catalog.name,
    numPages: catalog.numPages,
    file: `api/catalog/${catalog.id}/pdf`,
  }));

  return <CatalogBrowser catalogs={clientCatalogs} />;
}
