"use client";

import { upload } from "@vercel/blob/client";
import { useState } from "react";
import { BASE_PATH } from "@/lib/base-path";
import { pendingUploadPrefix } from "@/lib/pending-upload";
import type { CatalogEntry, Workspace } from "@/lib/account";

const api = (path: string) => `${BASE_PATH}${path}`;

export function CatalogDashboard({
  currentUserId,
  workspace,
  catalogs,
}: {
  currentUserId: string;
  workspace: Workspace;
  catalogs: CatalogEntry[];
}) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  async function doUpload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const input = e.currentTarget.elements.namedItem("file") as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      alert("Bitte eine PDF-Datei wählen.");
      return;
    }
    setBusy(true);
    try {
      setStatus("Datei wird hochgeladen...");
      const blob = await upload(`${pendingUploadPrefix(currentUserId)}${file.name}`, file, {
        access: "private",
        handleUploadUrl: api("/api/admin/blob-upload"),
        contentType: "application/pdf",
        multipart: true,
      });
      setStatus("Katalog wird verarbeitet...");
      const res = await fetch(api("/api/admin/ingest"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pathname: blob.pathname, filename: file.name }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Verarbeitung fehlgeschlagen.");
      }
      window.location.reload();
    } catch (err) {
      alert(`Upload fehlgeschlagen: ${(err as Error).message}`);
    } finally {
      setBusy(false);
      setStatus("");
    }
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <div className="flex items-start justify-between gap-6">
        <div>
          <p className="text-muted-foreground text-sm">{workspace.name}</p>
          <h1 className="text-2xl font-semibold">Kataloge</h1>
        </div>
        <span className="rounded-md border px-2 py-1 text-xs uppercase">
          {workspace.plan}
        </span>
      </div>

      <form onSubmit={doUpload} className="mt-8 rounded-md border p-4">
        <div className="flex flex-wrap items-center gap-3">
          <input type="file" name="file" accept="application/pdf" />
          <button
            disabled={busy}
            className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50"
          >
            {busy ? "Bitte warten..." : "Katalog hochladen"}
          </button>
          {status && <span className="text-sm text-muted-foreground">{status}</span>}
        </div>
        {workspace.plan === "free" && (
          <p className="mt-2 text-xs text-muted-foreground">
            Kostenlos: 1 Katalog, bis 20 Seiten, 3 Fragen.
          </p>
        )}
      </form>

      <div className="mt-8 space-y-3">
        {catalogs.map((catalog) => (
          <article key={catalog.id} className="rounded-md border p-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <a
                  href={api(`/catalog/${catalog.blob_catalog_id}`)}
                  className="font-medium underline"
                >
                  {catalog.name}
                </a>
                <p className="text-muted-foreground mt-1 text-xs">
                  {catalog.num_pages} Seiten, {catalog.question_count}/
                  {catalog.question_limit} Fragen genutzt
                </p>
              </div>
              <button
                type="button"
                onClick={() =>
                  navigator.clipboard.writeText(
                    `${location.origin}${api(`/catalog/${catalog.blob_catalog_id}`)}`,
                  )
                }
                className="rounded-md border px-3 py-2 text-sm"
              >
                Link kopieren
              </button>
            </div>
          </article>
        ))}
        {catalogs.length === 0 && (
          <p className="text-muted-foreground text-sm">
            Noch keine Kataloge. Lade deinen ersten Produktkatalog hoch.
          </p>
        )}
      </div>
    </main>
  );
}
