"use client";

import { useState } from "react";
import { upload } from "@vercel/blob/client";
import { BASE_PATH } from "@/lib/base-path";
import type { CatalogMeta } from "@/lib/catalog";

const api = (path: string) => `${BASE_PATH}${path}`;

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
      <img src={`${BASE_PATH}/igus-logo.svg`} alt="igus" className="mb-4 h-5 w-auto" />
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

export function AdminDashboard({ catalogs }: { catalogs: CatalogMeta[] }) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string>("");

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

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <img src={`${BASE_PATH}/igus-logo.svg`} alt="igus" className="mb-4 h-5 w-auto" />
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

      <ul className="mt-8 space-y-4">
        {catalogs.map((c) => (
          <li key={c.id} className="rounded-md border p-4">
            <div className="flex items-center justify-between">
              <a href={api(`/catalog/${c.id}`)} className="font-medium underline">
                {c.name}
              </a>
              <button onClick={() => remove(c.id)} className="text-sm text-red-600">
                Löschen
              </button>
            </div>
            <NotesEditor id={c.id} initial={c.notes} onSave={saveNotes} />
          </li>
        ))}
      </ul>
    </main>
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
