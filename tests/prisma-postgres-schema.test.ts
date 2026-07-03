import { afterEach, mock, test } from "node:test";
import assert from "node:assert/strict";

import { importPrismaModule, restorePrismaEnvironment } from "./helpers/prisma-module";

afterEach(() => {
  mock.reset();
  restorePrismaEnvironment();
});

test("prisma passes postgres schema options when the database URL names a schema", async () => {
  const databaseUrl = "postgresql://localhost:5432/readwise?schema=tenant_a";
  const result = await importPrismaModule({ databaseUrl, nodeEnv: "test", postgres: true });

  assert.deepEqual(result.sqliteAdapters, []);
  assert.deepEqual(result.pgAdapters, [{ connection: databaseUrl, options: { schema: "tenant_a" } }]);
  assert.deepEqual(result.prismaClientCalls[0]?.log, ["error"]);
  assert.equal((globalThis as { prisma?: unknown }).prisma, result.prisma);
});
