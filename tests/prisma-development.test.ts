import { afterEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import { importPrismaModule, restorePrismaEnvironment } from "./helpers/prisma-module";

afterEach(() => {
  mock.reset();
  restorePrismaEnvironment();
});

test("prisma includes warn logs for development sqlite clients", async () => {
  const result = await importPrismaModule({
    databaseUrl: "file:./local-dev.db",
    nodeEnv: "development",
    postgres: false,
  });

  assert.deepEqual(result.sqliteAdapters, [
    { url: `file:${path.join(process.cwd(), "prisma/local-dev.db").replace(/\\/g, "/")}` },
  ]);
  assert.deepEqual(result.prismaClientCalls[0]?.log, ["error", "warn"]);
});
