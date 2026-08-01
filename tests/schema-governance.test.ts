process.env.LOG_LEVEL = "error";

import assert from "node:assert/strict";
import {
  afterEach,
  test,
} from "node:test";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  generateSchemas,
  inspectSchemaGovernance,
  type SchemaGovernanceReport,
} from "../scripts/lib/schema-governance";
import { main } from "../scripts/check-schema-parity";

const temporaryRoots: string[] = [];
const VALID_BASE_SCHEMA = [
  "datasource db {",
  '  provider = "{{PROVIDER}}"',
  '  url = env("DATABASE_URL")',
  "}",
  "",
].join("\n");

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function createSchemaRoot(baseSchema = VALID_BASE_SCHEMA): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "readwise-schema-governance-"));
  temporaryRoots.push(root);
  await Promise.all([
    mkdir(join(root, "prisma/migrations"), { recursive: true }),
    mkdir(join(root, "prisma/postgresql/migrations"), { recursive: true }),
  ]);
  await writeFile(join(root, "prisma/base.prisma"), baseSchema, "utf8");
  return root;
}

async function addMigration(root: string, provider: "sqlite" | "postgresql", name: string) {
  const migrationRoot = provider === "sqlite"
    ? join(root, "prisma/migrations")
    : join(root, "prisma/postgresql/migrations");
  await mkdir(join(migrationRoot, name));
}

function passingReport(): SchemaGovernanceReport {
  return {
    ok: true,
    schemas: { ok: true, diagnostics: [] },
    migrations: { ok: true, diagnostics: [] },
  };
}

test("schema governance generates and accepts aligned artifacts", async () => {
  const root = await createSchemaRoot();
  const migration = "20260101000000_init";
  await Promise.all([
    addMigration(root, "sqlite", migration),
    addMigration(root, "postgresql", migration),
  ]);

  const generated = await generateSchemas(root);
  const report = await inspectSchemaGovernance(root);

  assert.deepEqual(generated, [
    { path: "prisma/schema.prisma", label: "SQLite" },
    { path: "prisma/postgresql/schema.prisma", label: "PostgreSQL" },
  ]);
  assert.equal(report.ok, true);
  assert.equal(report.schemas.ok, true);
  assert.equal(report.migrations.ok, true);
});

test("schema governance rejects a base schema without the provider placeholder", async () => {
  const root = await createSchemaRoot('datasource db {\n  provider = "sqlite"\n}\n');
  await Promise.all([
    writeFile(join(root, "prisma/schema.prisma"), "sqlite", "utf8"),
    writeFile(join(root, "prisma/postgresql/schema.prisma"), "postgresql", "utf8"),
  ]);

  await assert.rejects(() => generateSchemas(root), /must contain the placeholder/);
  const report = await inspectSchemaGovernance(root);
  assert.equal(report.ok, false);
  assert.match(report.schemas.diagnostics.join("\n"), /must contain the placeholder/);
});

test("schema governance reports the first committed schema difference", async () => {
  const root = await createSchemaRoot();
  await generateSchemas(root);
  const sqlitePath = join(root, "prisma/schema.prisma");
  const sqlite = await readFile(sqlitePath, "utf8");
  await writeFile(sqlitePath, sqlite.replace('url = env("DATABASE_URL")', 'url = "drift"'));

  const report = await inspectSchemaGovernance(root);

  assert.equal(report.schemas.ok, false);
  assert.match(report.schemas.diagnostics.join("\n"), /prisma\/schema\.prisma/);
  assert.match(report.schemas.diagnostics.join("\n"), /First difference at line/);
});

test("schema governance enforces one SQLite provider declaration", async () => {
  const root = await createSchemaRoot(
    `${VALID_BASE_SCHEMA}generator client {\n  provider = "sqlite"\n}\n`,
  );
  await generateSchemas(root);

  const report = await inspectSchemaGovernance(root);

  assert.equal(report.schemas.ok, false);
  assert.match(report.schemas.diagnostics.join("\n"), /exactly 1 occurrence/);
});

test("schema governance reports personal-data export policy drift", async () => {
  const root = await createSchemaRoot(`${VALID_BASE_SCHEMA}
model User {
  id                String   @id
  unclassifiedData  Profile?
}

model Profile {
  id String @id
}
`);
  await generateSchemas(root);

  const report = await inspectSchemaGovernance(root);

  assert.equal(report.schemas.ok, false);
  assert.match(
    report.schemas.diagnostics.join("\n"),
    /Personal-data export policy does not cover every Prisma User relation/,
  );
  assert.match(report.schemas.diagnostics.join("\n"), /User\.unclassifiedData/);
});

test("schema governance reports migrations missing from PostgreSQL", async () => {
  const root = await createSchemaRoot();
  await generateSchemas(root);
  await addMigration(root, "sqlite", "20260101000000_sqlite_only");

  const report = await inspectSchemaGovernance(root);

  assert.equal(report.migrations.ok, false);
  assert.match(report.migrations.diagnostics.join("\n"), /sqlite_only/);
  assert.match(report.migrations.diagnostics.join("\n"), /not prisma\/postgresql\/migrations/);
});

test("schema governance reports migrations missing from SQLite", async () => {
  const root = await createSchemaRoot();
  await generateSchemas(root);
  await addMigration(root, "postgresql", "20260101000000_postgres_only");

  const report = await inspectSchemaGovernance(root);

  assert.equal(report.migrations.ok, false);
  assert.match(report.migrations.diagnostics.join("\n"), /postgres_only/);
  assert.match(report.migrations.diagnostics.join("\n"), /not prisma\/migrations/);
});

test("schema governance accepts the repository artifacts", async () => {
  const report = await inspectSchemaGovernance(resolve(import.meta.dirname, ".."));
  assert.equal(report.ok, true, [
    ...report.schemas.diagnostics,
    ...report.migrations.diagnostics,
  ].join("\n"));
});

test("schema parity CLI renders a successful governance report", async () => {
  const logs: string[] = [];
  await main(
    async () => passingReport(),
    () => { throw new Error("unexpected exit"); },
    { log: (...args) => logs.push(args.join(" ")), error: () => {} },
  );

  assert.match(logs.join("\n"), /Schema parity: OK/);
  assert.match(logs.join("\n"), /Migration parity: OK/);
  assert.match(logs.join("\n"), /All schema parity checks passed/);
});

test("schema parity CLI exits with diagnostics when governance fails", async () => {
  const errors: string[] = [];
  const report = passingReport();
  report.ok = false;
  report.schemas = { ok: false, diagnostics: ["schema drift"] };
  let exitCode: number | undefined;

  await assert.rejects(
    main(
      async () => report,
      (code) => {
        exitCode = code;
        throw new Error("exit");
      },
      { log: () => {}, error: (...args) => errors.push(args.join(" ")) },
    ),
    /exit/,
  );

  assert.equal(exitCode, 1);
  assert.match(errors.join("\n"), /schema drift/);
  assert.match(errors.join("\n"), /Schema governance/);
});
