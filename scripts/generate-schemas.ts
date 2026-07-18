/**
 * Schema generator (BE-16).
 *
 * Reads `prisma/base.prisma` (the single source of truth) and writes:
 *   - `prisma/schema.prisma`            (SQLite — `provider = "sqlite"`)
 *   - `prisma/postgresql/schema.prisma` (PostgreSQL — `provider = "postgresql"`)
 *
 * Both output files are committed so that `prisma generate` can run without
 * Node.js tooling and editors receive full schema completion support.
 *
 * Usage:
 *   node --experimental-strip-types --no-warnings scripts/generate-schemas.ts
 *   npm run schema:generate   (after adding the script to package.json)
 *
 * Related check:
 *   `npm run schema:check-parity` verifies both committed schemas still match
 *   this generator's output and that SQLite/PostgreSQL migration directory
 *   names remain aligned.
 */
import { runScript, isMain } from "./lib/cli";
import { generateSchemas } from "./lib/schema-governance";

export { generateSchemas } from "./lib/schema-governance";

export async function main() {
  const generatedSchemas = await generateSchemas();
  for (const { path, label } of generatedSchemas) {
    console.log(`✔ Generated ${path} (${label})`);
  }
  console.log("\n✔ Schema generation complete.");
  console.log(
    "  Run 'git diff -- prisma/schema.prisma prisma/postgresql/schema.prisma' to confirm no drift.",
  );
}

export function runAsCli(importMetaUrl = import.meta.url): void {
  if (isMain(importMetaUrl)) {
    runScript(main, "Fatal error");
  }
}

runAsCli();
