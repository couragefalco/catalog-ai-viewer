// Bulk-Import der Laura-Sammlung: liest Laura_Asset_Metadaten_*.csv, baut
// Namen/Kategorien/Notizen deterministisch aus dem CSV (keine KI-Anreicherung)
// und lädt PDF + Record direkt in den Blob-Store.
//
// Usage:
//   npx tsx scripts/bulk-ingest.mts <src-dir> [--limit N] [--dry-run]
//
// Env (z. B. via `vercel env pull .env.ingest` + eigenem Loader unten):
//   BLOB_READ_WRITE_TOKEN, GOOGLE_GENERATIVE_AI_API_KEY
//
// Der Lauf ist resumierbar: erfolgreiche Dateien landen in
// <src-dir>/.ingest-progress.jsonl und werden beim nächsten Lauf übersprungen.
// Der Katalog-Index und die Summary-Vektoren werden am Ende einmal komplett
// geschrieben (kein Read-Modify-Write-Rennen bei parallelen Uploads).

import { readFileSync, readdirSync, existsSync, appendFileSync } from "node:fs";
import { join, resolve } from "node:path";

// .env.ingest laden, bevor lib/* (Blob/Google-Clients) importiert werden.
for (const envFile of [".env.ingest", ".env.local"]) {
  if (!existsSync(envFile)) continue;
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!m) continue;
    const value = m[2]
      .replace(/^"([\s\S]*)"$/, "$1")
      .replace(/\\n/g, "\n");
    // Leere Werte überspringen, damit z. B. ein leerer Prod-Key nicht den
    // echten Key aus der nächsten Datei verdeckt.
    if (value && !process.env[m[1]]) process.env[m[1]] = value;
  }
}

const { ingestPdf, slugify } = await import("../lib/ingest");
const {
  listCatalogs,
  rebuildCatalogIndex,
  saveCatalog,
  saveCatalogVectors,
  getSummaryVectors,
  saveSummaryVectors,
} = await import("../lib/store");
const { RAG_PAGE_THRESHOLD, embedTexts } = await import("../lib/embeddings");
type CatalogRecord = import("../lib/catalog").CatalogRecord;

// --- CLI ---------------------------------------------------------------

const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith("--"));
const srcDir = resolve(
  positional[0] ?? join(process.env.HOME ?? ".", "Desktop/laura-collection"),
);
const limitArg = args.indexOf("--limit");
const limit = limitArg >= 0 ? Number(args[limitArg + 1]) : Infinity;
const dryRun = args.includes("--dry-run");
const CONCURRENCY = 6;

// --- CSV ---------------------------------------------------------------

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') inQuotes = false;
      else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((f) => f !== "")) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f !== "")) rows.push(row);
  return rows;
}

type AssetRow = {
  file: string;
  h1: string;
  h2: string;
  series: string;
  quickId: string;
  kategorie: string;
  businessUnit: string;
};

function loadRows(): AssetRow[] {
  const csvName = readdirSync(srcDir)
    .filter((f) => /^Laura_Asset_Metadaten_\d+\.csv$/.test(f))
    .sort((a, b) => {
      const num = (s: string) => Number(s.match(/(\d+)/)?.[1] ?? 0);
      return num(b) - num(a);
    })[0];
  if (!csvName) throw new Error(`Kein Metadaten-CSV in ${srcDir} gefunden.`);
  const raw = readFileSync(join(srcDir, csvName), "utf8").replace(
    /^﻿/,
    "",
  );
  const [header, ...rows] = parseCsv(raw);
  const col = (name: string) => {
    const idx = header.indexOf(name);
    if (idx < 0) throw new Error(`CSV-Spalte "${name}" fehlt in ${csvName}.`);
    return idx;
  };
  const iFile = col("Asset-Dateiname");
  const iH1 = col("Headline 1");
  const iH2 = col("Headline 2");
  const iSeries = col("Serienbezeichnung");
  const iQuick = col("QuickID");
  const iKat = col("Kategorie");
  const iBu = col("BusinessUnit");
  console.log(`CSV: ${csvName}, ${rows.length} Zeilen`);
  return rows.map((r) => ({
    file: r[iFile]?.trim() ?? "",
    h1: r[iH1]?.trim() ?? "",
    h2: r[iH2]?.trim() ?? "",
    series: r[iSeries]?.trim() ?? "",
    quickId: r[iQuick]?.trim() ?? "",
    kategorie: r[iKat]?.trim() ?? "",
    businessUnit: r[iBu]?.trim() ?? "",
  }));
}

// --- Metadaten-Ableitung -------------------------------------------------

const BU_BY_QUICKID_PREFIX: Record<string, string> = {
  CF: "chainflex (CF)",
  RCA: "Readycable (RCA)",
};
const FALLBACK_CATEGORY = "Allgemein & Übersicht";

function categoryFor(row: AssetRow): string {
  if (row.businessUnit === "ECS") return "e-chains (ECS)";
  if (row.businessUnit) return row.businessUnit;
  const prefix = row.quickId.split(/[-.\s]/)[0]?.toUpperCase() ?? "";
  return BU_BY_QUICKID_PREFIX[prefix] ?? FALLBACK_CATEGORY;
}

function baseName(row: AssetRow): string {
  if (row.h1 && row.h2) return `${row.h1} – ${row.h2}`;
  return row.h1 || row.h2 || row.file.replace(/\.pdf$/i, "");
}

// Anzeigenamen eindeutig machen: Duplikate um Serie/QuickID ergänzen,
// notfalls durchnummerieren.
function assignNames(rows: AssetRow[]): Map<AssetRow, string> {
  const names = new Map<AssetRow, string>();
  const byBase = new Map<string, AssetRow[]>();
  for (const row of rows) {
    const base = baseName(row);
    byBase.set(base, [...(byBase.get(base) ?? []), row]);
  }
  for (const [base, group] of byBase) {
    if (group.length === 1) {
      names.set(group[0], base);
      continue;
    }
    const used = new Set<string>();
    group.forEach((row, i) => {
      const detail = row.series || row.quickId;
      let name = detail ? `${base} (${detail})` : base;
      if (used.has(name)) name = `${name} ${i + 1}`;
      used.add(name);
      names.set(row, name);
    });
  }
  return names;
}

// Kurze, lesbare IDs: Sprach-/MAT-/print-Bestandteile des Dateinamens entfernen.
function idFor(row: AssetRow, taken: Set<string>): string {
  const cleaned = row.file
    .replace(/\.pdf$/i, "")
    .replace(/^(de|eu)_/i, "")
    .replace(/mat\d+/gi, "")
    .replace(/_?print$/i, "");
  let id = slugify(cleaned) || slugify(row.file) || "katalog";
  if (taken.has(id)) {
    const full = slugify(row.file.replace(/\.pdf$/i, ""));
    id = taken.has(full) ? `${full}-2` : full;
    let n = 2;
    while (taken.has(id)) id = `${full}-${++n}`;
  }
  taken.add(id);
  return id;
}

function notesFor(row: AssetRow): string {
  const parts = [
    row.quickId && `QuickID: ${row.quickId}`,
    row.series && `Serie: ${row.series}`,
    row.kategorie && `Kategorie: ${row.kategorie}`,
    row.businessUnit && `Produktbereich: ${row.businessUnit}`,
  ].filter(Boolean);
  return parts.join(" · ");
}

const summaryText = (record: CatalogRecord) =>
  [
    record.name,
    record.category,
    record.notes,
    record.chunks
      .slice(0, 20)
      .map((c) => c.text)
      .join(" ")
      .slice(0, 4000),
  ]
    .filter(Boolean)
    .join("\n");

const roundVector = (v: number[]) => v.map((x) => Math.round(x * 1e5) / 1e5);

// --- Fortschritt ----------------------------------------------------------

const progressPath = join(srcDir, ".ingest-progress.jsonl");

function loadProgress(): Map<string, { id: string; summary: string }> {
  const done = new Map<string, { id: string; summary: string }>();
  if (!existsSync(progressPath)) return done;
  for (const line of readFileSync(progressPath, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      done.set(entry.file, { id: entry.id, summary: entry.summary ?? "" });
    } catch {
      // halbe Zeile durch Abbruch - ignorieren, Datei wird neu verarbeitet
    }
  }
  return done;
}

// --- Hauptlauf -------------------------------------------------------------

const rows = loadRows().filter((r) => r.file);
const missing = rows.filter((r) => !existsSync(join(srcDir, r.file)));
if (missing.length) {
  console.warn(`${missing.length} CSV-Zeilen ohne PDF, werden übersprungen.`);
}
const present = rows.filter((r) => existsSync(join(srcDir, r.file)));

const names = assignNames(present);
const done = loadProgress();
const existing = dryRun ? [] : await listCatalogs();
const taken = new Set<string>(existing.map((c) => c.id));
for (const entry of done.values()) taken.add(entry.id);

// Bereits (früher/manuell) importierte Quelldateien nicht doppeln.
const existingBySource = new Set(
  existing.map((c) => c.sourceFile).filter(Boolean),
);

const todo = present
  .filter((r) => !done.has(r.file) && !existingBySource.has(r.file))
  .slice(0, limit);

console.log(
  `${present.length} Dateien im CSV, ${done.size} bereits importiert, ${todo.length} zu verarbeiten${dryRun ? " (dry-run)" : ""}.`,
);

if (dryRun) {
  const ids = new Map<string, string>();
  todo.forEach((row, i) => {
    const id = idFor(row, taken);
    ids.set(row.file, id);
    if (i < 20) {
      console.log(
        `${row.file}\n  -> id=${id}\n     name=${names.get(row)}\n     category=${categoryFor(row)}\n     notes=${notesFor(row)}`,
      );
    }
  });
  const nameSet = new Set(todo.map((r) => names.get(r)));
  console.log(
    `dry-run: ${ids.size} eindeutige IDs, ${nameSet.size} eindeutige Namen bei ${todo.length} Dateien.`,
  );
  process.exit(0);
}

let ok = 0;
let failed = 0;
const failures: string[] = [];

async function processRow(row: AssetRow): Promise<void> {
  const bytes = new Uint8Array(readFileSync(join(srcDir, row.file)));
  const { numPages, chunks } = await ingestPdf(bytes);
  const id = idFor(row, taken);
  const record: CatalogRecord = {
    id,
    name: names.get(row) ?? baseName(row),
    numPages,
    notes: notesFor(row),
    exampleQuestions: [],
    createdAt: new Date().toISOString(),
    mode: numPages >= RAG_PAGE_THRESHOLD ? "rag" : "full",
    category: categoryFor(row),
    series: row.series || undefined,
    quickId: row.quickId || undefined,
    sourceFile: row.file,
    chunks,
  };
  await saveCatalog(record, bytes, { updateIndex: false });
  if (record.mode === "rag") {
    const vectors = await embedTexts(chunks.map((c) => c.text));
    await saveCatalogVectors(id, vectors);
  }
  appendFileSync(
    progressPath,
    JSON.stringify({ file: row.file, id, summary: summaryText(record) }) + "\n",
  );
  ok++;
  if (ok % 25 === 0) console.log(`  ${ok}/${todo.length} hochgeladen…`);
}

const queue = [...todo];
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length) {
      const row = queue.shift();
      if (!row) return;
      try {
        await processRow(row);
      } catch (err) {
        failed++;
        failures.push(row.file);
        console.error(`FEHLER ${row.file}: ${(err as Error).message}`);
      }
    }
  }),
);

console.log(`Upload fertig: ${ok} ok, ${failed} Fehler.`);
if (failures.length) console.log("Fehlgeschlagen:", failures.join(", "));

// Summary-Vektoren für alle in diesem und früheren Läufen importierten Dateien
// in einem Rutsch berechnen und mit dem bestehenden Blob zusammenführen.
const allDone = loadProgress();
const entries = [...allDone.values()].filter((e) => e.summary);
console.log(`Berechne ${entries.length} Summary-Vektoren…`);
const existingVectors = (await getSummaryVectors()) ?? {};
const BATCH = 100;
for (let i = 0; i < entries.length; i += BATCH) {
  const batch = entries.slice(i, i + BATCH);
  const vectors = await embedTexts(batch.map((e) => e.summary));
  batch.forEach((e, j) => {
    if (vectors[j]) existingVectors[e.id] = roundVector(vectors[j]);
  });
  console.log(`  ${Math.min(i + BATCH, entries.length)}/${entries.length}`);
}
await saveSummaryVectors(existingVectors);

console.log("Baue Katalog-Index neu…");
const metas = await rebuildCatalogIndex();
console.log(`Index: ${metas.length} Kataloge. Fertig.`);
