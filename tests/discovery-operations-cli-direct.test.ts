process.env.LOG_LEVEL = "error";

import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, beforeEach, mock, test } from "node:test";

type BaselineReport = {
  eligibleArticles: number;
  identities: number;
  candidatesCreated: number;
  candidatesExisting: number;
  aliasesCreated: number;
  aliasesExisting: number;
  conflicts: number;
  conflictsCreated: number;
  conflictsExisting: number;
  conflictedArticles: number;
  skipped: Array<{ reason: string }>;
  conflictDetails: Array<{ reason: string; articleIds: string[] }>;
};

const baselineCalls: unknown[] = [];
const ledgerCalls: unknown[] = [];
let baselineReport: BaselineReport;
let ledgerRows: Array<{ observationKey: string }> = [];
let unexplainedMisses = 0;

before(() => {
  mock.module("@/lib/scraper/incremental/baseline-backfill", {
    namedExports: {
      BASELINE_IDENTITY_VERSION: 2,
      backfillDiscoveryBaseline: async (args: unknown) => {
        baselineCalls.push(args);
        return baselineReport;
      },
    },
  });
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        discoveryObservation: {
          findMany: async (args: unknown) => {
            ledgerCalls.push(args);
            return ledgerRows;
          },
        },
      },
    },
  });
  mock.module("@/lib/scraper/incremental/reconciliation", {
    namedExports: {
      reconcile: (sample: unknown[], ledger: unknown[]) => ({
        sampleSize: sample.length,
        ledgerSize: ledger.length,
        hits: 1,
        explainedMisses: 1,
        unexplainedMisses,
        extras: 2,
        unexplainedMissIds: unexplainedMisses > 0 ? ["v1:missing"] : [],
      }),
    },
  });
});

beforeEach(() => {
  baselineCalls.length = 0;
  ledgerCalls.length = 0;
  ledgerRows = [{ observationKey: "v1:hit" }];
  unexplainedMisses = 0;
  baselineReport = {
    eligibleArticles: 4,
    identities: 3,
    candidatesCreated: 2,
    candidatesExisting: 1,
    aliasesCreated: 2,
    aliasesExisting: 1,
    conflicts: 1,
    conflictsCreated: 1,
    conflictsExisting: 0,
    conflictedArticles: 2,
    skipped: [],
    conflictDetails: [],
  };
});

function withArgv<T>(args: string[], run: () => Promise<T>): Promise<T> {
  const original = process.argv;
  process.argv = [process.execPath, "script.ts", ...args];
  return run().finally(() => {
    process.argv = original;
  });
}

test("baseline CLI parses mode and prints dry-run skip/conflict metadata", async (t) => {
  baselineReport.skipped = [{ reason: "missing-source-url" }, { reason: "missing-source-url" }];
  baselineReport.conflictDetails = [{ reason: "identity-collision", articleIds: ["article-1", "article-2"] }];
  const logs: string[] = [];
  t.mock.method(console, "log", (message: string) => logs.push(message));
  const cli = await import("../scripts/backfill-discovery-baseline");

  assert.deepEqual(cli.parseArgs([]), { dryRun: false });
  assert.deepEqual(cli.parseArgs(["--dry-run"]), { dryRun: true });
  assert.equal(await withArgv(["--dry-run"], () => cli.main()), 0);

  assert.deepEqual(baselineCalls, [{ dryRun: true }]);
  assert.match(logs.join("\n"), /dry-run, no writes/);
  assert.match(logs.join("\n"), /missing-source-url: 2/);
  assert.match(logs.join("\n"), /identity-collision: 2 articles/);
  assert.match(logs.join("\n"), /Dry-run complete/);
});

test("baseline CLI covers the empty applied report", async (t) => {
  const logs: string[] = [];
  t.mock.method(console, "log", (message: string) => logs.push(message));
  const cli = await import("../scripts/backfill-discovery-baseline");

  assert.equal(await withArgv([], () => cli.main()), 0);
  assert.deepEqual(baselineCalls, [{ dryRun: false }]);
  assert.doesNotMatch(logs.join("\n"), /Conflict details/);
  assert.match(logs.join("\n"), /Baseline seed complete/);
});

test("reconciliation CLI validates arguments and reads controlled samples", async () => {
  const cli = await import("../scripts/reconcile-discovery-canary");
  assert.deepEqual(cli.parseArgs(["--sample", "sample.json", "--source", "source-1"]), {
    sourceId: "source-1",
    samplePath: "sample.json",
  });
  assert.throws(() => cli.parseArgs([]), /usage:/);

  const dir = mkdtempSync(join(tmpdir(), "readwise-reconcile-"));
  const samplePath = join(dir, "sample.json");
  writeFileSync(samplePath, JSON.stringify({ items: [{ identityKey: "v1:hit", expectedObservable: true }] }));
  assert.deepEqual(await cli.readSample(samplePath), [{ identityKey: "v1:hit", expectedObservable: true }]);
  writeFileSync(samplePath, JSON.stringify({ items: "invalid" }));
  assert.deepEqual(await cli.readSample(samplePath), []);

  assert.deepEqual(await cli.readLedgerEntries("source-1"), [{ identityKey: "v1:hit" }]);
  assert.deepEqual((ledgerCalls[0] as { where: unknown }).where, { discoverySourceId: "source-1" });
});

test("reconciliation CLI returns zero for a clean comparison and one for unexplained misses", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "readwise-reconcile-main-"));
  const samplePath = join(dir, "sample.json");
  writeFileSync(samplePath, JSON.stringify({ items: [{ identityKey: "v1:hit", expectedObservable: true }] }));
  const logs: string[] = [];
  t.mock.method(console, "log", (message: string) => logs.push(message));
  const cli = await import("../scripts/reconcile-discovery-canary");

  assert.equal(await withArgv(["--source", "source-1", "--sample", samplePath], () => cli.main()), 0);
  unexplainedMisses = 1;
  assert.equal(await withArgv(["--source", "source-1", "--sample", samplePath], () => cli.main()), 1);

  assert.match(logs.join("\n"), /Reconciliation for source source-1/);
  assert.match(logs.join("\n"), /Unexplained miss ids: \[v1:missing\]/);
});
