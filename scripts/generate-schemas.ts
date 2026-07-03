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
 * Replacing `schema:check-parity`:
 *   `npm run schema:check-parity` reads the two generated schemas and verifies
 *   they are identical except for the provider line — identical to what this
 *   generator would produce. Running the generator and then `git diff` serves
 *   the same purpose in CI.
 */
import { readFile, writeFile } from "node:fs/promises";
import { runScript, isMain } from "./lib/cli";

const BASE_SCHEMA = "prisma/base.prisma";
const SQLITE_SCHEMA = "prisma/schema.prisma";
const POSTGRES_SCHEMA = "prisma/postgresql/schema.prisma";

const PLACEHOLDER = '{{PROVIDER}}';

const OUTPUT_SCHEMAS = [
  { path: SQLITE_SCHEMA, provider: "sqlite", label: "SQLite" },
  { path: POSTGRES_SCHEMA, provider: "postgresql", label: "PostgreSQL" },
] as const;

function renderSchema(base: string, provider: string): string {
  return base.replace(PLACEHOLDER, provider);
}

async function generateSchemas(): Promise<void> {
  const base = await readFile(BASE_SCHEMA, "utf8");

  if (!base.includes(PLACEHOLDER)) {
    throw new Error(
      `${BASE_SCHEMA} must contain the placeholder '${PLACEHOLDER}' in the datasource provider field.`,
    );
  }

  await Promise.all(
    OUTPUT_SCHEMAS.map(({ path, provider }) =>
      writeFile(path, renderSchema(base, provider), "utf8"),
    ),
  );

  for (const { path, label } of OUTPUT_SCHEMAS) {
    console.log(`✔ Generated ${path} (${label})`);
  }
}

async function main() {
  await generateSchemas();
  console.log("\n✔ Schema generation complete.");
  console.log(
    "  Run 'git diff -- prisma/schema.prisma prisma/postgresql/schema.prisma' to confirm no drift.",
  );
}

if (isMain(import.meta.url)) {
  runScript(main, "Fatal error");
}
