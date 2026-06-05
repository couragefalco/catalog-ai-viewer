// Ensures the generated data modules exist so the app type-checks and builds
// even before `npm run ingest` has been run. Copies the committed *.example.ts
// stubs into place ONLY when the real (gitignored) generated file is missing —
// it never overwrites real generated data. Runs via predev / prebuild.
import { existsSync, copyFileSync } from "fs";

const pairs = [
  ["lib/catalogs.example.ts", "lib/catalogs.ts"],
  ["lib/chunks-data.example.ts", "lib/chunks-data.ts"],
];

for (const [example, real] of pairs) {
  if (!existsSync(real)) {
    copyFileSync(example, real);
    console.log(`ensure-data: created ${real} from stub (run \`npm run ingest\` to populate)`);
  }
}
