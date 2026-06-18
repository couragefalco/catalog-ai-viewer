"use client";

import { useState } from "react";
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

  const upload = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    if (!(form.get("file") as File)?.size) return;
    setBusy(true);
    const res = await fetch(api("/api/admin/catalogs"), {
      method: "POST",
      body: form,
    });
    setBusy(false);
    if (res.ok) window.location.reload();
    else alert((await res.json()).error ?? "Upload fehlgeschlagen.");
  };

  const saveNotes = async (id: string, notes: string) => {
    await fetch(api(`/api/admin/catalogs/${id}`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes }),
    });
  };

  const remove = async (id: string) => {
    if (!confirm("Diesen Katalog löschen?")) return;
    await fetch(api(`/api/admin/catalogs/${id}`), { method: "DELETE" });
    window.location.reload();
  };

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="text-2xl font-semibold">Kataloge verwalten</h1>

      <form onSubmit={upload} className="mt-6 flex items-center gap-3 rounded-md border p-4">
        <input type="file" name="file" accept="application/pdf" />
        <button
          disabled={busy}
          className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50"
        >
          {busy ? "Wird verarbeitet…" : "Hochladen"}
        </button>
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
  onSave: (id: string, notes: string) => Promise<void>;
}) {
  const [notes, setNotes] = useState(initial);
  const [saved, setSaved] = useState(false);
  return (
    <div className="mt-3">
      <label className="text-muted-foreground text-xs">
        Zusätzlicher Kontext für die KI (z. B. Produktnamen-Varianten)
      </label>
      <textarea
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
          await onSave(id, notes);
          setSaved(true);
        }}
        className="mt-1 rounded-md border px-2 py-1 text-xs"
      >
        {saved ? "Gespeichert" : "Notizen speichern"}
      </button>
    </div>
  );
}
