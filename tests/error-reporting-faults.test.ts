process.env.LOG_LEVEL = "error";

import { test, mock } from "node:test";
import assert from "node:assert/strict";

mock.module("@/lib/metrics", {
  namedExports: {
    recordErrorCaptured: () => {
      throw new Error("metrics unavailable");
    },
  },
});

test("captureError tolerates metric recorder failures", async () => {
  const { captureError, setErrorSink, resetErrorReporting } = await import("@/lib/observability/errors");
  resetErrorReporting();
  const restore = setErrorSink(() => {});
  try {
    assert.doesNotThrow(() => captureError(new Error("metric fallback"), { source: "server" }));
  } finally {
    restore();
  }
});
