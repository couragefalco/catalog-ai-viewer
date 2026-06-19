import Link from "next/link";
import { BASE_PATH } from "@/lib/base-path";
import { listCatalogs } from "@/lib/store";
import { CatalogBrowser } from "@/components/catalog-browser";

export const dynamic = "force-dynamic";

export default async function Home() {
  const catalogs = await listCatalogs();

  if (catalogs.length === 0) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-16">
        <img src={`${BASE_PATH}/igus-logo.svg`} alt="igus" className="mb-4 h-5 w-auto" />
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

  // Show the main PRT compact catalog (the 8-page one) first so it loads by
  // default; keep the rest alphabetical.
  const rank = (c: { id: string; numPages: number }) =>
    c.numPages === 8 && /kompaktkatalog/i.test(c.id)
      ? 0
      : /kompaktkatalog/i.test(c.id)
        ? 1
        : 2;
  const ordered = [...catalogs].sort(
    (a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name),
  );

  // Map stored metadata to the viewer's client shape; the PDF is served by the
  // private streaming route (browser cannot read the blob directly).
  const clientCatalogs = ordered.map((c) => ({
    id: c.id,
    name: c.name,
    numPages: c.numPages,
    file: `api/catalog/${c.id}/pdf`,
  }));

  return <CatalogBrowser catalogs={clientCatalogs} />;
}
