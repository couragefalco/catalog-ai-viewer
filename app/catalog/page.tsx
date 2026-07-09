import Link from "next/link";
import { CatalogBrowser } from "@/components/catalog-browser";
import { getOrderedClientCatalogs } from "./catalog-list";

export const dynamic = "force-dynamic";

export default async function IgusCatalogPage() {
  const clientCatalogs = await getOrderedClientCatalogs();

  if (clientCatalogs.length === 0) {
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

  return <CatalogBrowser catalogs={clientCatalogs} />;
}
