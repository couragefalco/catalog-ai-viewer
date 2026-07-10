// Einmalige Reparatur: Chunk- und Summary-Vektoren für Kataloge nachziehen,
// deren Embedding beim Bulk-Import fehlschlug (Batch-Limit).
// Usage: npx tsx scripts/repair-vectors.mts <sourceFile> [<sourceFile> ...]
import { readFileSync, existsSync } from "node:fs";

for (const envFile of [".env.ingest", ".env.local"]) {
  if (!existsSync(envFile)) continue;
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!m) continue;
    const value = m[2].replace(/^"([\s\S]*)"$/, "$1");
    if (value && !process.env[m[1]]) process.env[m[1]] = value;
  }
}

const {
  listCatalogs,
  getCatalog,
  saveCatalogVectors,
  upsertSummaryVector,
} = await import("../lib/store");
const { embedTexts } = await import("../lib/embeddings");
const { buildSummaryVector } = await import("../lib/process-upload");

const sourceFiles = process.argv.slice(2);
if (!sourceFiles.length) throw new Error("sourceFile-Argumente fehlen");

const metas = await listCatalogs();
for (const sourceFile of sourceFiles) {
  const meta = metas.find((m) => m.sourceFile === sourceFile);
  if (!meta) {
    console.error(`NICHT GEFUNDEN: ${sourceFile}`);
    continue;
  }
  const record = await getCatalog(meta.id);
  if (!record) {
    console.error(`RECORD FEHLT: ${meta.id}`);
    continue;
  }
  if (record.mode === "rag") {
    const vectors = await embedTexts(record.chunks.map((c) => c.text));
    await saveCatalogVectors(record.id, vectors);
    console.log(`${record.id}: ${vectors.length} Chunk-Vektoren gespeichert`);
  }
  const summary = await buildSummaryVector(record);
  if (summary) {
    await upsertSummaryVector(record.id, summary);
    console.log(`${record.id}: Summary-Vektor gespeichert`);
  }
}
console.log("Fertig.");
