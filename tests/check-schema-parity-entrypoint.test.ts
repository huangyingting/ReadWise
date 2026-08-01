process.env.LOG_LEVEL = "error";

import assert from "node:assert/strict";
import { mock, test } from "node:test";

let runScriptCall:
  | { main: () => Promise<number | void>; label: string | undefined }
  | undefined;

mock.module("../scripts/lib/cli.ts", {
  namedExports: {
    isMain: () => true,
    runScript: (main: () => Promise<number | void>, label?: string) => {
      runScriptCall = { main, label };
    },
  },
});

test("schema parity executable delegates its main function to the shared CLI runner", async () => {
  await import("../scripts/check-schema-parity");

  assert.equal(typeof runScriptCall?.main, "function");
  assert.equal(runScriptCall?.label, "Fatal error");
});
