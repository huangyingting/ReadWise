import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const BASE_SCHEMA_PATH = "prisma/base.prisma";
const PROVIDER_PLACEHOLDER = "{{PROVIDER}}";

const SCHEMA_ARTIFACTS = [
  {
    path: "prisma/schema.prisma",
    provider: "sqlite",
    label: "SQLite",
  },
  {
    path: "prisma/postgresql/schema.prisma",
    provider: "postgresql",
    label: "PostgreSQL",
  },
] as const;

const MIGRATION_ARTIFACTS = {
  sqlite: "prisma/migrations",
  postgresql: "prisma/postgresql/migrations",
} as const;

export type GeneratedSchema = {
  path: string;
  label: string;
};

export type SchemaGovernanceCheck = {
  ok: boolean;
  diagnostics: string[];
};

export type SchemaGovernanceReport = {
  ok: boolean;
  schemas: SchemaGovernanceCheck;
  migrations: SchemaGovernanceCheck;
};

function fromRoot(rootDir: string, relativePath: string): string {
  return join(rootDir, relativePath);
}

function renderSchema(baseSchema: string, provider: string): string {
  return baseSchema.replace(PROVIDER_PLACEHOLDER, provider);
}

function assertProviderPlaceholder(baseSchema: string): void {
  if (!baseSchema.includes(PROVIDER_PLACEHOLDER)) {
    throw new Error(
      `${BASE_SCHEMA_PATH} must contain the placeholder '${PROVIDER_PLACEHOLDER}' in the datasource provider field.`,
    );
  }
}

export async function generateSchemas(rootDir = "."): Promise<GeneratedSchema[]> {
  const baseSchema = await readFile(fromRoot(rootDir, BASE_SCHEMA_PATH), "utf8");
  assertProviderPlaceholder(baseSchema);

  await Promise.all(
    SCHEMA_ARTIFACTS.map((artifact) =>
      writeFile(
        fromRoot(rootDir, artifact.path),
        renderSchema(baseSchema, artifact.provider),
        "utf8",
      ),
    ),
  );

  return SCHEMA_ARTIFACTS.map(({ path, label }) => ({ path, label }));
}

function firstSchemaDifference(expected: string, actual: string): string | null {
  const expectedLines = expected.split("\n");
  const actualLines = actual.split("\n");
  const lineCount = Math.max(expectedLines.length, actualLines.length);

  for (let index = 0; index < lineCount; index += 1) {
    if (expectedLines[index] !== actualLines[index]) {
      return [
        `  First difference at line ${index + 1}:`,
        `    Expected generated: ${JSON.stringify(expectedLines[index])}`,
        `    Actual committed:   ${JSON.stringify(actualLines[index])}`,
      ].join("\n");
    }
  }

  return null;
}

function inspectSchemas(
  baseSchema: string,
  committedSchemas: readonly string[],
): SchemaGovernanceCheck {
  const diagnostics: string[] = [];

  try {
    assertProviderPlaceholder(baseSchema);
  } catch (error) {
    return {
      ok: false,
      diagnostics: [error instanceof Error ? error.message : String(error)],
    };
  }

  SCHEMA_ARTIFACTS.forEach((artifact, index) => {
    const actual = committedSchemas[index] ?? "";
    const expected = renderSchema(baseSchema, artifact.provider);
    if (actual === expected) return;

    diagnostics.push(
      `  ${artifact.path} is not generated from ${BASE_SCHEMA_PATH}.`,
      "  Run `npm run schema:generate` and commit the regenerated schema.",
    );
    const difference = firstSchemaDifference(expected, actual);
    if (difference) diagnostics.push(difference);
  });

  const sqliteProviderCount = (
    committedSchemas[0]?.match(/provider\s*=\s*"sqlite"/g) ?? []
  ).length;
  if (sqliteProviderCount !== 1) {
    diagnostics.push(
      `  Expected exactly 1 occurrence of provider = "sqlite" in ${SCHEMA_ARTIFACTS[0].path} but found ${sqliteProviderCount}.`,
    );
  }

  return { ok: diagnostics.length === 0, diagnostics };
}

function migrationNames(entries: string[]): string[] {
  return entries.filter((entry) => /^\d{14}_/.test(entry)).sort();
}

function inspectMigrations(
  sqliteMigrations: string[],
  postgresMigrations: string[],
): SchemaGovernanceCheck {
  const onlyInSqlite = sqliteMigrations.filter(
    (migration) => !postgresMigrations.includes(migration),
  );
  const onlyInPostgres = postgresMigrations.filter(
    (migration) => !sqliteMigrations.includes(migration),
  );
  const diagnostics: string[] = [];

  if (onlyInSqlite.length > 0) {
    diagnostics.push(
      `  Migrations in ${MIGRATION_ARTIFACTS.sqlite} but not ${MIGRATION_ARTIFACTS.postgresql}:`,
      ...onlyInSqlite.map((migration) => `    - ${migration}`),
    );
  }
  if (onlyInPostgres.length > 0) {
    diagnostics.push(
      `  Migrations in ${MIGRATION_ARTIFACTS.postgresql} but not ${MIGRATION_ARTIFACTS.sqlite}:`,
      ...onlyInPostgres.map((migration) => `    - ${migration}`),
    );
  }

  return { ok: diagnostics.length === 0, diagnostics };
}

export async function inspectSchemaGovernance(
  rootDir = ".",
): Promise<SchemaGovernanceReport> {
  const [baseSchema, committedSchemas, migrationEntries] = await Promise.all([
    readFile(fromRoot(rootDir, BASE_SCHEMA_PATH), "utf8"),
    Promise.all(
      SCHEMA_ARTIFACTS.map((artifact) =>
        readFile(fromRoot(rootDir, artifact.path), "utf8"),
      ),
    ),
    Promise.all([
      readdir(fromRoot(rootDir, MIGRATION_ARTIFACTS.sqlite)),
      readdir(fromRoot(rootDir, MIGRATION_ARTIFACTS.postgresql)),
    ]),
  ]);
  const [sqliteMigrationEntries, postgresMigrationEntries] = migrationEntries;
  const sqliteMigrations = migrationNames(sqliteMigrationEntries);
  const postgresMigrations = migrationNames(postgresMigrationEntries);
  const schemas = inspectSchemas(baseSchema, committedSchemas);
  const migrations = inspectMigrations(sqliteMigrations, postgresMigrations);

  return {
    ok: schemas.ok && migrations.ok,
    schemas,
    migrations,
  };
}