import { afterEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

import { importPrismaModule, restorePrismaEnvironment } from "./helpers/prisma-module";

afterEach(() => {
  mock.reset();
  restorePrismaEnvironment();
});

test("prisma omits postgres schema options and global caching in production", async () => {
  const databaseUrl = "postgresql://localhost:5432/readwise";
  const result = await importPrismaModule({
    databaseUrl,
    nodeEnv: "production",
    postgres: true,
    prismaSchemaPath: "prisma/postgresql/schema.prisma",
  });

  assert.deepEqual(result.pgAdapters, [{ connection: databaseUrl, options: undefined }]);
  assert.equal((globalThis as { prisma?: unknown }).prisma, undefined);
});

test("prisma rejects production database/schema mismatches before connecting", () => {
  const result = spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      "--import",
      "./scripts/register-ts.mjs",
      "--no-warnings",
      "-e",
      "import('./src/lib/prisma.ts').catch((error) => { console.error(error.message); process.exit(1); });",
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        PATH: process.env.PATH ?? "",
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://localhost:5432/readwise",
        PRISMA_SCHEMA_PATH: "prisma/schema.prisma",
      },
    },
  );

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /DATABASE_URL targets PostgreSQL, but PRISMA_SCHEMA_PATH selects the SQLite Prisma schema/,
  );
});
