process.env.LOG_LEVEL = "error";

import assert from "node:assert/strict";
import { mock, test } from "node:test";

const runnerCalls: Array<{ main: () => Promise<number | void>; label: string | undefined }> = [];

mock.module("../scripts/lib/cli.ts", {
  namedExports: {
    isMain: () => true,
    runScript: (main: () => Promise<number | void>, label?: string) => {
      runnerCalls.push({ main, label });
    },
    parseString: () => null,
    parsePositiveInt: (_argv: string[], _flag: string, fallback: number) => fallback,
    parseFlag: () => false,
    warnUnknown: () => undefined,
  },
});

mock.module("@/lib/scraper/incremental/baseline-backfill", {
  namedExports: {
    BASELINE_IDENTITY_VERSION: 2,
    backfillDiscoveryBaseline: async () => ({}),
  },
});

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      discoveryObservation: { findMany: async () => [] },
    },
  },
});

mock.module("@/lib/scraper/incremental/reconciliation", {
  namedExports: { reconcile: () => ({}) },
});

mock.module("../scripts/translation-prompt-lab/vllm-client.ts", {
  namedExports: {
    chatCompleteWithRetry: async () => ({ text: "", finishReason: null, usage: null, durationMs: 0 }),
  },
});

test("translation and discovery executable modules delegate guarded mains to runScript", async () => {
  await Promise.all([
    import("../scripts/backfill-discovery-baseline"),
    import("../scripts/reconcile-discovery-canary"),
    import("../scripts/translation-prompt-lab/bench-concurrency"),
    import("../scripts/translation-prompt-lab/diag-marker"),
    import("../scripts/translation-prompt-lab/evaluate"),
    import("../scripts/translation-prompt-lab/sample"),
    import("../scripts/translation-prompt-lab/translate-articles"),
    import("../scripts/translation-prompt-lab/translate"),
  ]);

  assert.equal(runnerCalls.length, 8);
  assert.ok(runnerCalls.every((call) => typeof call.main === "function"));
  assert.deepEqual(
    runnerCalls.map((call) => call.label).sort(),
    [
      "Baseline seed failed",
      "Discovery canary reconciliation failed",
      "bench-concurrency failed",
      "evaluate failed",
      "sample failed",
      "translate failed",
      "translate-articles failed",
      "translation marker diagnostic failed",
    ].sort(),
  );
});
