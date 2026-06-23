process.env.LOG_LEVEL = "error";

import { test } from "node:test";
import assert from "node:assert/strict";
import { SLI_CATALOG, evaluateSlos } from "@/lib/slo";
import type { MetricsSnapshot } from "@/lib/metrics";

// ---- catalog coverage ----------------------------------------------------

test("SLI catalog covers every product-critical flow", () => {
  const flows = new Set(SLI_CATALOG.map((sli) => sli.flow));
  // The required flows from RW-034.
  for (const flow of [
    "Sign-in",
    "Dashboard load",
    "Article reader load",
    "Reading progress save",
    "Dictionary lookup",
    "AI feature response",
    "Article import",
    "Background processing",
  ]) {
    assert.ok(flows.has(flow), `missing SLI for flow: ${flow}`);
  }
});

test("SLI catalog distinguishes interactive from background flows", () => {
  const interactive = SLI_CATALOG.filter((s) => s.category === "interactive");
  const background = SLI_CATALOG.filter((s) => s.category === "background");
  assert.ok(interactive.length > 0, "expected interactive SLIs");
  assert.ok(background.length > 0, "expected background SLIs");
  // Worker latency is a background indicator; dictionary is interactive.
  assert.equal(SLI_CATALOG.find((s) => s.key === "worker_latency")?.category, "background");
  assert.equal(SLI_CATALOG.find((s) => s.key === "dictionary_lookup")?.category, "interactive");
});

test("every SLI has a [0,1] objective", () => {
  for (const sli of SLI_CATALOG) {
    assert.ok(sli.objective >= 0 && sli.objective <= 1, `${sli.key} objective out of range`);
  }
});

// ---- evaluation from a synthetic snapshot --------------------------------

function buildSnapshot(): MetricsSnapshot {
  return {
    counters: [
      // Worker availability: 9 success / (9+1) = 0.9 → meets objective 0.9.
      {
        name: "readwise_worker_jobs_total",
        help: "",
        labels: { outcome: "success", published: "true" },
        value: 9,
      },
      {
        name: "readwise_worker_jobs_total",
        help: "",
        labels: { outcome: "failed", published: "false" },
        value: 1,
      },
      // AI availability: 19 success / (19+1) = 0.95 → meets objective 0.95.
      {
        name: "readwise_ai_calls_total",
        help: "",
        labels: { feature: "quiz", outcome: "success", status_class: "2xx" },
        value: 19,
      },
      {
        name: "readwise_ai_calls_total",
        help: "",
        labels: { feature: "quiz", outcome: "error", status_class: "5xx" },
        value: 1,
      },
      // /api/feed availability: all 2xx (no 5xx) → availability 1.0.
      {
        name: "readwise_api_requests_total",
        help: "",
        labels: { method: "GET", route: "/api/feed", status: "200", status_class: "2xx" },
        value: 10,
      },
    ],
    histograms: [
      // /api/feed latency: only 1 of 10 under 1000ms → 0.1 < 0.95 → breaching.
      {
        name: "readwise_api_request_duration_ms",
        help: "",
        labels: { method: "GET", route: "/api/feed", status_class: "2xx" },
        buckets: [
          { le: 100, count: 0 },
          { le: 500, count: 0 },
          { le: 1000, count: 1 },
          { le: 2500, count: 5 },
        ],
        count: 10,
        sum: 18000,
      },
    ],
  };
}

test("evaluateSlos computes status from a metrics snapshot", () => {
  const report = evaluateSlos(buildSnapshot());

  const byKey = Object.fromEntries(report.slis.map((s) => [s.key, s]));

  // Worker success at exactly the objective → ok.
  assert.equal(byKey.worker_processing.status, "ok");
  assert.equal(byKey.worker_processing.value, 0.9);
  assert.equal(byKey.worker_processing.sampleCount, 10);

  // AI availability at the objective → ok.
  assert.equal(byKey.ai_feature_response.status, "ok");
  assert.equal(byKey.ai_feature_response.value, 0.95);

  // Dashboard feed latency well below target → breaching.
  assert.equal(byKey.dashboard_load.status, "breaching");
  assert.equal(byKey.dashboard_load.value, 0.1);

  // Flows with no matching data → no_data (not a failure).
  assert.equal(byKey.sign_in.status, "no_data");
  assert.equal(byKey.sign_in.value, null);
  assert.equal(byKey.worker_latency.status, "no_data");

  // Summary counts are consistent.
  assert.equal(report.total, SLI_CATALOG.length);
  assert.equal(report.ok + report.breaching + report.noData, report.total);
  assert.ok(report.breaching >= 1);
});

test("evaluateSlos reports all no_data for an empty snapshot", () => {
  const report = evaluateSlos({ counters: [], histograms: [] });
  assert.equal(report.noData, SLI_CATALOG.length);
  assert.equal(report.ok, 0);
  assert.equal(report.breaching, 0);
});

test("reader latency SLI matches the /api/reader/* route prefix", () => {
  const snapshot: MetricsSnapshot = {
    counters: [],
    histograms: [
      {
        name: "readwise_api_request_duration_ms",
        help: "",
        labels: { method: "POST", route: "/api/reader/[id]/progress", status_class: "2xx" },
        buckets: [
          { le: 500, count: 8 },
          { le: 2500, count: 10 },
        ],
        count: 10,
        sum: 4000,
      },
    ],
  };
  const report = evaluateSlos(snapshot);
  const readerLoad = report.slis.find((s) => s.key === "reader_load")!;
  // 10/10 under 2500ms → 1.0 ≥ 0.9 → ok.
  assert.equal(readerLoad.value, 1);
  assert.equal(readerLoad.status, "ok");
  // progress_save (exact route, 500ms threshold): 8/10 under 500ms → 0.8 < 0.95.
  const progress = report.slis.find((s) => s.key === "progress_save")!;
  assert.equal(progress.value, 0.8);
  assert.equal(progress.status, "breaching");
});
