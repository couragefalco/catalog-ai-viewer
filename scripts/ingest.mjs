// Optional bulk importer: uploads every PDF in CATALOG_SRC to a running
// instance via the admin API. Requires the app running and an admin session.
// Usage: BASE_URL=http://localhost:3000 ADMIN_PASSWORD=... \
//        CATALOG_SRC=./source-pdfs node scripts/ingest.mjs
import { readdirSync, readFileSync } from "fs";
import { join } from "path";

const SRC = process.env.CATALOG_SRC || "./source-pdfs";
const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const password = process.env.ADMIN_PASSWORD;
if (!password) throw new Error("Set ADMIN_PASSWORD");

const login = await fetch(`${BASE_URL}/api/admin/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ password }),
});
const cookie = login.headers.get("set-cookie");
if (!login.ok || !cookie) throw new Error("Login failed");

const files = readdirSync(SRC).filter((f) => f.toLowerCase().endsWith(".pdf"));
for (const file of files) {
  const form = new FormData();
  form.append(
    "file",
    new Blob([readFileSync(join(SRC, file))], { type: "application/pdf" }),
    file,
  );
  const res = await fetch(`${BASE_URL}/api/admin/catalogs`, {
    method: "POST",
    headers: { cookie: cookie.split(";")[0] },
    body: form,
  });
  console.log(file, res.status, await res.text());
}
