import { afterEach, mock, test } from "node:test";
import assert from "node:assert/strict";

import { importPrismaModule, restorePrismaEnvironment } from "./helpers/prisma-module";

afterEach(() => {
  mock.reset();
  restorePrismaEnvironment();
});

test("prisma omits postgres schema options and global caching in production", async () => {
  const databaseUrl = "postgresql://localhost:5432/readwise";
  const result = await importPrismaModule({ databaseUrl, nodeEnv: "production", postgres: true });

  assert.deepEqual(result.pgAdapters, [{ connection: databaseUrl, options: undefined }]);
  assert.equal((globalThis as { prisma?: unknown }).prisma, undefined);
});
