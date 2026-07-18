/**
 * Schema Parity Check (REF-069)
 *
 * Verifies that generated Prisma schemas still match prisma/base.prisma, the
 * single source of truth. The generated schemas must be byte-identical except
 * for the datasource provider line:
 *
 *   SQLite:     provider = "sqlite"
 *   PostgreSQL: provider = "postgresql"
 *
 * Also verifies that both migration directories contain the same set of named
 * migrations (timestamps/names). Migration SQL content is legitimately
 * engine-specific (e.g. PostgreSQL emits CREATE TYPE for enums), but the
 * migration history — the ordered list of named migration directories — must
 * stay aligned so that both engines track the same logical schema version.
 *
 * Exit codes:
 *   0 — schemas and migrations are in parity
 *   1 — drift detected; details printed to stderr
 *
 * Usage:
 *   npm run schema:check-parity
 *   node --experimental-strip-types scripts/check-schema-parity.ts
 */
import { runScript, isMain } from "./lib/cli";
import {
  inspectSchemaGovernance,
  type SchemaGovernanceCheck,
  type SchemaGovernanceReport,
} from "./lib/schema-governance";

type GovernanceCheckFn = () => Promise<SchemaGovernanceReport>;
type ExitFn = (code: number) => never;

type MainOutput = {
  log: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
};

function reportCheck(
  check: SchemaGovernanceCheck,
  messages: { success: string; failure: string },
  output: MainOutput,
): void {
  if (check.ok) {
    output.log(messages.success);
    return;
  }

  output.error(messages.failure);
  for (const diagnostic of check.diagnostics) {
    output.error(diagnostic);
  }
}

export async function main(
  inspect: GovernanceCheckFn = inspectSchemaGovernance,
  exit: ExitFn = process.exit,
  output: MainOutput = console,
): Promise<void> {
  const report = await inspect();

  reportCheck(
    report.schemas,
    { success: "✔ Schema parity: OK", failure: "❌ Schema parity check FAILED" },
    output,
  );
  reportCheck(
    report.migrations,
    { success: "✔ Migration parity: OK", failure: "❌ Migration parity check FAILED" },
    output,
  );

  if (!report.ok) {
    output.error(
      "\nSee docs/platform/database.md §Schema governance for the schema-change workflow.",
    );
    exit(1);
  }

  output.log("\n✔ All schema parity checks passed.");
}

if (isMain(import.meta.url)) {
  runScript(main, "Fatal error");
}
