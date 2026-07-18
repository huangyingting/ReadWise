import { afterEach, mock, test } from "node:test";
import assert from "node:assert/strict";

import { importPrismaModule, restorePrismaEnvironment } from "./helpers/prisma-module";

afterEach(() => {
  mock.reset();
  restorePrismaEnvironment();
});

test("prisma reuses an existing non-production global client", async () => {
  const existingPrisma = { existing: true };
  const result = await importPrismaModule({
    nodeEnv: "test",
    existingPrisma,
  });

  assert.equal(result.prisma, existingPrisma);
  assert.deepEqual(result.sqliteAdapters, []);
  assert.deepEqual(result.pgAdapters, []);
  assert.deepEqual(result.prismaClientCalls, []);
  assert.equal((globalThis as { prisma?: unknown }).prisma, existingPrisma);
});
