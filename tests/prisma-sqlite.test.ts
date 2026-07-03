import { afterEach, mock, test } from "node:test";
import assert from "node:assert/strict";

import { importPrismaModule, restorePrismaEnvironment } from "./helpers/prisma-module";

afterEach(() => {
  mock.reset();
  restorePrismaEnvironment();
});

test("prisma initializes the default sqlite client and caches it outside production", async () => {
  const result = await importPrismaModule({ nodeEnv: "test", postgres: false });

  assert.deepEqual(result.sqliteAdapters, [{ url: "file:./dev.db" }]);
  assert.deepEqual(result.pgAdapters, []);
  assert.deepEqual(result.prismaClientCalls[0]?.log, ["error"]);
  assert.equal((globalThis as { prisma?: unknown }).prisma, result.prisma);
});
