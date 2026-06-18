import Link from "next/link";
import { FileText } from "lucide-react";
import { listCatalogs } from "@/lib/store";

export default async function Home() {
  const catalogs = await listCatalogs();

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-2xl font-semibold">Katalog-Assistent</h1>
      <p className="text-muted-foreground mt-2 text-sm">
        Wähle einen Katalog, um Fragen dazu zu stellen.
      </p>
      <ul className="mt-8 space-y-2">
        {catalogs.length === 0 ? (
          <li className="text-muted-foreground text-sm">
            Noch keine Kataloge. Lade im{" "}
            <Link href="/admin" className="underline">
              Admin-Bereich
            </Link>{" "}
            einen hoch.
          </li>
        ) : (
          catalogs.map((c) => (
            <li key={c.id}>
              <Link
                href={`/catalog/${c.id}`}
                className="hover:bg-muted flex items-center gap-3 rounded-md border px-4 py-3"
              >
                <FileText className="h-4 w-4 shrink-0" />
                <span className="flex-1">{c.name}</span>
                <span className="text-muted-foreground font-mono text-xs">
                  {c.numPages} S.
                </span>
              </Link>
            </li>
          ))
        )}
      </ul>
    </main>
  );
}
