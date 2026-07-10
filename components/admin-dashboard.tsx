"use client";

import { useMemo, useState } from "react";
import { upload } from "@vercel/blob/client";
import { ChevronRight } from "lucide-react";
import { ASSET_PATH, BASE_PATH } from "@/lib/base-path";
import { cn } from "@/lib/utils";
import type { CatalogMeta } from "@/lib/catalog";
import type { Catalog } from "@/components/catalog-viewer";
import type { ShareLink } from "@/lib/share-links";

// Kataloge ohne Kategorie (ältere Uploads) landen in dieser Gruppe.
const FALLBACK_GROUP = "Weitere Kataloge";
// Nicht-Produkt-Gruppen ans Ende, Produktbereiche zuerst.
const TRAILING_GROUPS = new Set([
  FALLBACK_GROUP,
  "Allgemein & Übersicht",
  "Technical_data (DATA)",
]);

function groupByCategory<T extends { category?: string }>(
  items: T[],
): [string, T[]][] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = item.category?.trim() || FALLBACK_GROUP;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return [...groups.entries()].sort(([a], [b]) => {
    const ta = TRAILING_GROUPS.has(a) ? 1 : 0;
    const tb = TRAILING_GROUPS.has(b) ? 1 : 0;
    return ta - tb || a.localeCompare(b, "de");
  });
}

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

export function AdminLogin() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await fetch(api("/api/admin/login"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (res.ok) window.location.reload();
    else setError(true);
  };

  return (
    <main className="mx-auto max-w-sm px-6 py-24">
      <img src={`${ASSET_PATH}/igus-logo.svg`} alt="igus" className="mb-4 h-5 w-auto" />
      <h1 className="text-xl font-semibold">Admin-Anmeldung</h1>
      <form onSubmit={submit} className="mt-6 space-y-3">
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Passwort"
          className="w-full rounded-md border px-3 py-2 text-sm"
        />
        {error && <p className="text-sm text-red-600">Falsches Passwort.</p>}
        <button className="w-full rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground">
          Anmelden
        </button>
      </form>
    </main>
  );
}

export function AdminDashboard({
  catalogs,
  allCatalogs,
  shareLinks,
}: {
  catalogs: CatalogMeta[];
  allCatalogs: Catalog[];
  shareLinks: ShareLink[];
}) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string>("");
  const [links, setLinks] = useState(shareLinks);
  const [shareBusy, setShareBusy] = useState(false);
  const [catalogQuery, setCatalogQuery] = useState("");
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

  const q = catalogQuery.trim().toLowerCase();
  const visibleCatalogs = useMemo(
    () =>
      q
        ? catalogs.filter((c) =>
            [c.name, c.category, c.quickId, c.series, c.id]
              .filter(Boolean)
              .some((field) => field!.toLowerCase().includes(q)),
          )
        : catalogs,
    [catalogs, q],
  );
  const catalogGroups = useMemo(
    () => groupByCategory(visibleCatalogs),
    [visibleCatalogs],
  );
  const shareCatalogGroups = useMemo(
    () => groupByCategory(allCatalogs),
    [allCatalogs],
  );
  // Während einer Suche alle Treffer-Gruppen aufklappen.
  const isGroupOpen = (group: string) => (q ? true : (openGroups[group] ?? false));

  const doUpload = async (e: React.FormEvent<HTMLFormElement>) => {
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
      setStatus("Datei wird hochgeladen…");
      const blob = await upload(`pending/${file.name}`, file, {
        access: "private",
        handleUploadUrl: api("/api/admin/blob-upload"),
        contentType: "application/pdf",
        multipart: true,
      });
      setStatus("Wird verarbeitet (Text + KI)…");
      const res = await fetch(api("/api/admin/ingest"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pathname: blob.pathname, filename: file.name }),
      });
      if (!res.ok) {
        const msg = await res.text();
        throw new Error(msg || "Verarbeitung fehlgeschlagen.");
      }
      window.location.reload();
    } catch (err) {
      alert(`Upload fehlgeschlagen: ${(err as Error).message}`);
    } finally {
      setBusy(false);
      setStatus("");
    }
  };

  const saveNotes = async (id: string, notes: string): Promise<boolean> => {
    const res = await fetch(api(`/api/admin/catalogs/${id}`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes }),
    });
    return res.ok;
  };

  const remove = async (id: string) => {
    if (!confirm("Diesen Katalog löschen?")) return;
    const res = await fetch(api(`/api/admin/catalogs/${id}`), { method: "DELETE" });
    if (!res.ok) {
      alert("Löschen fehlgeschlagen.");
      return;
    }
    window.location.reload();
  };

  const createShareLink = async (e: React.FormEvent<HTMLFormElement>) => {
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
  };

  const deleteShareLink = async (slug: string) => {
    if (!confirm("Diesen Share-Link löschen?")) return;
    const res = await fetch(api(`/api/admin/share-links/${slug}`), {
      method: "DELETE",
    });
    if (!res.ok) {
      alert("Löschen fehlgeschlagen.");
      return;
    }
    setLinks((current) => current.filter((link) => link.slug !== slug));
  };

  const shareUrl = (slug: string) =>
    `${location.origin}${api(`/catalog/id/${slug}`)}`;

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <img src={`${ASSET_PATH}/igus-logo.svg`} alt="igus" className="mb-4 h-5 w-auto" />
      <h1 className="text-2xl font-semibold">Kataloge verwalten</h1>

      <form onSubmit={doUpload} className="mt-6 rounded-md border p-4">
        <div className="flex items-center gap-3">
          <input type="file" name="file" accept="application/pdf" />
          <button
            disabled={busy}
            className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50"
          >
            {busy ? "Bitte warten…" : "Hochladen"}
          </button>
          {status && <span className="text-sm text-muted-foreground">{status}</span>}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Große PDFs (auch hunderte Seiten) werden jetzt unterstützt.
        </p>
      </form>

      <section className="mt-8 rounded-md border p-4">
        <h2 className="text-lg font-semibold">Share-Links</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Links fuer Kunden erstellen, die direkt in einen Katalog oder in die
          globale Katalogsuche starten.
        </p>

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
              {shareCatalogGroups.map(([group, items]) => (
                <optgroup key={group} label={group}>
                  {items.map((catalog) => (
                    <option key={catalog.id} value={catalog.id}>
                      {catalog.name}
                    </option>
                  ))}
                </optgroup>
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

      <section className="mt-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Kataloge</h2>
            <p className="text-muted-foreground mt-1 text-sm">
              {catalogs.length} Kataloge in {groupByCategory(catalogs).length}{" "}
              Produktbereichen
            </p>
          </div>
          <input
            type="search"
            value={catalogQuery}
            onChange={(e) => setCatalogQuery(e.target.value)}
            placeholder="Suchen (Name, Bereich, QuickID)…"
            className="w-full rounded-md border px-3 py-2 text-sm sm:w-72"
          />
        </div>

        {visibleCatalogs.length === 0 && (
          <p className="text-muted-foreground mt-4 text-sm">
            Kein Katalog gefunden.
          </p>
        )}

        <div className="mt-4 space-y-2">
          {catalogGroups.map(([group, items]) => (
            <div key={group} className="overflow-hidden rounded-md border">
              <button
                type="button"
                onClick={() =>
                  setOpenGroups((current) => ({
                    ...current,
                    [group]: !isGroupOpen(group),
                  }))
                }
                className="hover:bg-muted/50 flex w-full items-center gap-2 px-4 py-3 text-left"
              >
                <ChevronRight
                  className={cn(
                    "text-muted-foreground h-4 w-4 shrink-0 transition-transform",
                    isGroupOpen(group) && "rotate-90",
                  )}
                />
                <span className="min-w-0 truncate text-sm font-medium">
                  {group}
                </span>
                <span className="text-muted-foreground ml-auto shrink-0 font-mono text-xs tabular-nums">
                  {items.length}
                </span>
              </button>
              {isGroupOpen(group) && (
                <ul className="divide-y border-t">
                  {items.map((c) => (
                    <AdminCatalogRow
                      key={c.id}
                      catalog={c}
                      onRemove={remove}
                      onSaveNotes={saveNotes}
                      api={api}
                    />
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

function AdminCatalogRow({
  catalog,
  onRemove,
  onSaveNotes,
  api,
}: {
  catalog: CatalogMeta;
  onRemove: (id: string) => void;
  onSaveNotes: (id: string, notes: string) => Promise<boolean>;
  api: (path: string) => string;
}) {
  const [showNotes, setShowNotes] = useState(false);
  const detail = [
    `${catalog.numPages} ${catalog.numPages === 1 ? "Seite" : "Seiten"}`,
    catalog.quickId,
    catalog.series,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <li className="px-4 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <a
            href={api(`/catalog/${catalog.id}`)}
            className="block truncate text-sm font-medium underline-offset-2 hover:underline"
          >
            {catalog.name}
          </a>
          <p className="text-muted-foreground mt-0.5 text-xs">{detail}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setShowNotes((v) => !v)}
            className="rounded-md border px-2 py-1 text-xs"
          >
            {showNotes ? "Notizen ausblenden" : "Notizen"}
          </button>
          <button
            type="button"
            onClick={() => onRemove(catalog.id)}
            className="rounded-md border px-2 py-1 text-xs text-red-600"
          >
            Löschen
          </button>
        </div>
      </div>
      {showNotes && (
        <NotesEditor id={catalog.id} initial={catalog.notes} onSave={onSaveNotes} />
      )}
    </li>
  );
}

function NotesEditor({
  id,
  initial,
  onSave,
}: {
  id: string;
  initial: string;
  onSave: (id: string, notes: string) => Promise<boolean>;
}) {
  const [notes, setNotes] = useState(initial);
  const [saved, setSaved] = useState(false);
  return (
    <div className="mt-3">
      <label htmlFor={`notes-${id}`} className="text-muted-foreground text-xs">
        Zusätzlicher Kontext für die KI (z. B. Produktnamen-Varianten)
      </label>
      <textarea
        id={`notes-${id}`}
        value={notes}
        onChange={(e) => {
          setNotes(e.target.value);
          setSaved(false);
        }}
        rows={3}
        className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
      />
      <button
        onClick={async () => {
          const ok = await onSave(id, notes);
          if (ok) setSaved(true);
          else alert("Speichern fehlgeschlagen.");
        }}
        className="mt-1 rounded-md border px-2 py-1 text-xs"
      >
        {saved ? "Gespeichert" : "Notizen speichern"}
      </button>
    </div>
  );
}
