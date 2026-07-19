/**
 * Pure unit tests for the discovery-canary reconciliation (issue #1090,
 * Phase 1.10). `reconciliation.ts` is PURE; these tests cover hit, explained-miss,
 * unexplained-miss, extra, duplicate collapsing, and the per-category rollup.
 */
process.env.LOG_LEVEL = "error";

import { test } from "node:test";
import assert from "node:assert/strict";

import { reconcile } from "@/lib/scraper/incremental/reconciliation";

test("classifies hit, explained-miss, unexplained-miss, and extra", () => {
  const sample = [
    { identityKey: "v1:hit", expectedObservable: true },
    { identityKey: "v1:explained", expectedObservable: false },
    { identityKey: "v1:unexplained", expectedObservable: true },
  ];
  const ledger = [{ identityKey: "v1:hit" }, { identityKey: "v1:extra" }];

  const result = reconcile(sample, ledger);

  assert.equal(result.sampleSize, 3);
  assert.equal(result.ledgerSize, 2);
  assert.equal(result.hits, 1);
  assert.equal(result.explainedMisses, 1);
  assert.equal(result.unexplainedMisses, 1);
  assert.equal(result.extras, 1);
  assert.deepEqual(result.unexplainedMissIds, ["v1:unexplained"]);
  assert.deepEqual(result.extraIds, ["v1:extra"]);
});

test("a clean canary has zero unexplained misses", () => {
  const sample = [
    { identityKey: "v1:a", expectedObservable: true },
    { identityKey: "v1:b", expectedObservable: true },
    { identityKey: "v1:old", expectedObservable: false },
  ];
  const ledger = [{ identityKey: "v1:a" }, { identityKey: "v1:b" }];
  const result = reconcile(sample, ledger);
  assert.equal(result.hits, 2);
  assert.equal(result.unexplainedMisses, 0);
  assert.equal(result.explainedMisses, 1);
});

test("duplicate sample and ledger keys are collapsed (each identity compared once)", () => {
  const sample = [
    { identityKey: "v1:a", expectedObservable: true },
    { identityKey: "v1:a", expectedObservable: true },
  ];
  const ledger = [{ identityKey: "v1:a" }, { identityKey: "v1:a" }];
  const result = reconcile(sample, ledger);
  assert.equal(result.sampleSize, 1);
  assert.equal(result.ledgerSize, 1);
  assert.equal(result.hits, 1);
});

test("per-category rollup tallies outcomes by sanitized category", () => {
  const sample = [
    { identityKey: "v1:a", expectedObservable: true, category: "science" },
    { identityKey: "v1:b", expectedObservable: true, category: "science" },
    { identityKey: "v1:c", expectedObservable: true, category: "history" },
  ];
  const ledger = [{ identityKey: "v1:a" }];
  const result = reconcile(sample, ledger);
  assert.deepEqual(result.byCategory.science, { hits: 1, explainedMisses: 0, unexplainedMisses: 1 });
  assert.deepEqual(result.byCategory.history, { hits: 0, explainedMisses: 0, unexplainedMisses: 1 });
});

test("an empty sample yields an all-zero result with extras from the ledger", () => {
  const result = reconcile([], [{ identityKey: "v1:x" }]);
  assert.equal(result.sampleSize, 0);
  assert.equal(result.hits, 0);
  assert.equal(result.unexplainedMisses, 0);
  assert.equal(result.extras, 1);
});
