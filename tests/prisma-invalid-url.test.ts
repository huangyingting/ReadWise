import { afterEach, mock, test } from "node:test";
import assert from "node:assert/strict";

import { importPrismaModule, restorePrismaEnvironment } from "./helpers/prisma-module";

afterEach(() => {
  mock.reset();
  restorePrismaEnvironment();
});

test("prisma surfaces invalid postgres URLs during client initialization", async () => {
  await assert.rejects(
    () => importPrismaModule({ databaseUrl: "postgresql://[", nodeEnv: "test" }),
    TypeError,
  );
});
