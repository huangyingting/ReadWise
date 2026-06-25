/**
 * Focused tests for the metrics registry primitives: label normalisation,
 * histogram bucket counts, and snapshot behaviour.
 */

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeLabelValue,
  statusClass,
  normalizeOutcome,
  incCounter,
  observeHistogram,
  getMetricsSnapshot,
  resetMetrics,
  API_DURATION_BUCKETS_MS,
} from "@/lib/metrics/registry";

beforeEach(() => {
  resetMetrics();
});

// ─── normalizeLabelValue ────────────────────────────────────────────────────

test("normalizeLabelValue lowercases and strips unsafe chars", () => {
  assert.equal(normalizeLabelValue("Hello World!"), "hello_world_");
  assert.equal(normalizeLabelValue("some/path:123"), "some/path:123");
  assert.equal(normalizeLabelValue(null), "unknown");
  assert.equal(normalizeLabelValue(undefined), "unknown");
  assert.equal(normalizeLabelValue(""), "unknown");
  assert.equal(normalizeLabelValue("   "), "unknown");
});

test("normalizeLabelValue trims to 80 chars", () => {
  const long = "a".repeat(100);
  assert.equal(normalizeLabelValue(long).length, 80);
});

test("normalizeLabelValue collapses multiple underscores", () => {
  assert.equal(normalizeLabelValue("a!!b"), "a_b");
});

// ─── statusClass ────────────────────────────────────────────────────────────

test("statusClass returns correct coarsenings", () => {
  assert.equal(statusClass(200), "2xx");
  assert.equal(statusClass(404), "4xx");
  assert.equal(statusClass(500), "5xx");
  assert.equal(statusClass("201"), "2xx");
  assert.equal(statusClass(0), "unknown");
  assert.equal(statusClass(-1), "unknown");
  assert.equal(statusClass(NaN), "unknown");
});

// ─── normalizeOutcome ───────────────────────────────────────────────────────

test("normalizeOutcome passes known values and rejects unknowns", () => {
  const allowed = ["success", "failed"] as const;
  assert.equal(normalizeOutcome("success", allowed), "success");
  assert.equal(normalizeOutcome("failed", allowed), "failed");
  assert.equal(normalizeOutcome("other", allowed), "unknown");
  assert.equal(normalizeOutcome("", allowed), "unknown");
});

// ─── histogram bucket counts ────────────────────────────────────────────────

test("observeHistogram increments all buckets ≥ the observed value", () => {
  // Buckets: [10, 25, 50, 100, ...]
  // Observing 30 ms → buckets 50, 100, … should increment; buckets 10, 25 should not.
  observeHistogram("test_hist", "help", API_DURATION_BUCKETS_MS, { label: "a" }, 30);

  const snap = getMetricsSnapshot();
  const h = snap.histograms[0];
  assert.ok(h, "histogram must exist");
  assert.equal(h.count, 1);
  assert.equal(h.sum, 30);

  for (const { le, count } of h.buckets) {
    if (le < 30) {
      assert.equal(count, 0, `bucket le=${le} should be 0 for observation 30`);
    } else {
      assert.equal(count, 1, `bucket le=${le} should be 1 for observation 30`);
    }
  }
});

test("observeHistogram accumulates multiple observations correctly", () => {
  observeHistogram("test_hist", "help", API_DURATION_BUCKETS_MS, { label: "a" }, 10);
  observeHistogram("test_hist", "help", API_DURATION_BUCKETS_MS, { label: "a" }, 10);
  observeHistogram("test_hist", "help", API_DURATION_BUCKETS_MS, { label: "a" }, 100);

  const snap = getMetricsSnapshot();
  const h = snap.histograms[0];
  assert.equal(h.count, 3);
  assert.equal(h.sum, 120);

  // le=10 bucket should have count 2 (both 10ms observations)
  const le10 = h.buckets.find((b) => b.le === 10);
  assert.ok(le10);
  assert.equal(le10.count, 2);

  // le=100 bucket should have count 3 (all three observations)
  const le100 = h.buckets.find((b) => b.le === 100);
  assert.ok(le100);
  assert.equal(le100.count, 3);
});

test("observeHistogram clamps negative or non-finite values to 0", () => {
  observeHistogram("test_hist", "help", API_DURATION_BUCKETS_MS, { label: "a" }, -5);
  observeHistogram("test_hist", "help", API_DURATION_BUCKETS_MS, { label: "a" }, Infinity);
  observeHistogram("test_hist", "help", API_DURATION_BUCKETS_MS, { label: "a" }, NaN);

  const snap = getMetricsSnapshot();
  const h = snap.histograms[0];
  assert.equal(h.count, 3);
  assert.equal(h.sum, 0); // all clamped to 0
  // le=10 bucket should have count 3 (all clamped to 0, which is ≤ 10)
  const le10 = h.buckets.find((b) => b.le === 10);
  assert.ok(le10);
  assert.equal(le10.count, 3);
});

// ─── counter incCounter ─────────────────────────────────────────────────────

test("incCounter accumulates values for the same series", () => {
  incCounter("test_counter", "help", { a: "x" }, 2);
  incCounter("test_counter", "help", { a: "x" }, 3);

  const snap = getMetricsSnapshot();
  const c = snap.counters.find((p) => p.name === "test_counter");
  assert.ok(c);
  assert.equal(c.value, 5);
});

test("incCounter treats distinct label sets as separate series", () => {
  incCounter("test_counter", "help", { a: "x" });
  incCounter("test_counter", "help", { a: "y" });

  const snap = getMetricsSnapshot();
  assert.equal(snap.counters.filter((p) => p.name === "test_counter").length, 2);
});
