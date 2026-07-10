"use client";

import { upload } from "@vercel/blob/client";
import { useState } from "react";
import { BASE_PATH } from "@/lib/base-path";
import { pendingUploadPrefix } from "@/lib/pending-upload";
import type { CatalogEntry, Workspace } from "@/lib/account";
import type { Catalog } from "@/components/catalog-viewer";
import type { ShareLink } from "@/lib/share-links";

const currentApiBase = () => {
  if (
    typeof window !== "undefined" &&
    window.location.pathname.startsWith("/catalog")
  ) {
    return "/catalog";
  }
  return BASE_PATH;
};

const api = (path: string) =>
  path.startsWith("/api") ? `${currentApiBase()}${path}` : `${BASE_PATH}${path}`;

export function CatalogDashboard({
  currentUserId,
  workspace,
  catalogs,
  allCatalogs,
  shareLinks,
}: {
  currentUserId: string;
  workspace: Workspace;
  catalogs: CatalogEntry[];
  allCatalogs: Catalog[];
  shareLinks: ShareLink[];
}) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [links, setLinks] = useState(shareLinks);
  const [shareBusy, setShareBusy] = useState(false);

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

  async function createShareLink(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formEl = e.currentTarget;
    const form = new FormData(formEl);
    const slug = String(form.get("slug") ?? "");
    const name = String(form.get("name") ?? "");
    const catalogId = String(form.get("catalogId") ?? "");
    const mode = String(form.get("mode") ?? "document");
    setShareBusy(true);
    try {
      const res = await fetch(api("/api/admin/share-links"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug,
          name,
          catalogId,
          mode: mode === "global" ? "global" : "document",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Share-Link fehlgeschlagen.");
      setLinks((current) => [
        data.link,
        ...current.filter((link) => link.slug !== data.link.slug),
      ]);
      formEl.reset();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setShareBusy(false);
    }
  }

  async function deleteShareLink(slug: string) {
    if (!confirm("Diesen Share-Link löschen?")) return;
    const res = await fetch(api(`/api/admin/share-links/${slug}`), {
      method: "DELETE",
    });
    if (!res.ok) {
      alert("Löschen fehlgeschlagen.");
      return;
    }
    setLinks((current) => current.filter((link) => link.slug !== slug));
  }

  const shareUrl = (slug: string) =>
    `${location.origin}${api(`/catalog/id/${slug}`)}`;

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

      <section className="mt-8 rounded-md border p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">Share-Links</h2>
            <p className="text-muted-foreground mt-1 text-sm">
              Erstelle Links, die direkt in einen Katalog oder in die globale
              Katalogsuche starten.
            </p>
          </div>
        </div>

        <form onSubmit={createShareLink} className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground text-xs">Name</span>
            <input
              name="name"
              placeholder="Kunde oder Kampagne"
              className="w-full rounded-md border px-3 py-2"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground text-xs">Slug</span>
            <input
              name="slug"
              required
              placeholder="kunde-prt-demo"
              className="w-full rounded-md border px-3 py-2"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground text-xs">Startkatalog</span>
            <select
              name="catalogId"
              required
              className="w-full rounded-md border bg-background px-3 py-2"
              defaultValue={allCatalogs[0]?.id}
            >
              {allCatalogs.map((catalog) => (
                <option key={catalog.id} value={catalog.id}>
                  {catalog.name}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground text-xs">Startmodus</span>
            <select
              name="mode"
              className="w-full rounded-md border bg-background px-3 py-2"
              defaultValue="document"
            >
              <option value="document">Dokument</option>
              <option value="global">Alle Kataloge</option>
            </select>
          </label>
          <div className="md:col-span-2">
            <button
              disabled={shareBusy || allCatalogs.length === 0}
              className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50"
            >
              {shareBusy ? "Speichere..." : "Share-Link erstellen"}
            </button>
          </div>
        </form>

        <div className="mt-5 space-y-2">
          {links.map((link) => {
            const catalog = allCatalogs.find((c) => c.id === link.catalogId);
            return (
              <article
                key={link.slug}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border px-3 py-2"
              >
                <div className="min-w-0">
                  <a
                    href={api(`/catalog/id/${link.slug}`)}
                    className="font-medium underline"
                  >
                    {link.name}
                  </a>
                  <p className="text-muted-foreground mt-0.5 text-xs">
                    /catalog/id/{link.slug} · {catalog?.name ?? link.catalogId} ·{" "}
                    {link.mode === "global" ? "Alle Kataloge" : "Dokument"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => navigator.clipboard.writeText(shareUrl(link.slug))}
                    className="rounded-md border px-2 py-1 text-xs"
                  >
                    Link kopieren
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteShareLink(link.slug)}
                    className="rounded-md border px-2 py-1 text-xs text-red-600"
                  >
                    Löschen
                  </button>
                </div>
              </article>
            );
          })}
          {links.length === 0 && (
            <p className="text-muted-foreground text-sm">
              Noch keine Share-Links erstellt.
            </p>
          )}
        </div>
      </section>

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
