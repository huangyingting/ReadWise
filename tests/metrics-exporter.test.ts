/**
 * Focused tests for the Prometheus text-format exporter.
 *
 * Exercises label escaping, HELP/TYPE header deduplication, histogram bucket
 * rendering (including the +Inf bucket), and empty-snapshot output.
 */

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { incCounter, observeHistogram, resetMetrics, API_DURATION_BUCKETS_MS } from "@/lib/metrics/registry";
import { exportMetricsPrometheus, escapePrometheusLabelValue } from "@/lib/metrics/exporter";

beforeEach(() => {
  resetMetrics();
});

test("empty snapshot produces a single trailing newline", () => {
  assert.equal(exportMetricsPrometheus(), "\n");
});

test("counter is rendered with HELP, TYPE, and value line", () => {
  incCounter("my_counter", "A test counter.", { label: "val" });
  const text = exportMetricsPrometheus();
  assert.match(text, /^# HELP my_counter A test counter\./m);
  assert.match(text, /^# TYPE my_counter counter$/m);
  assert.match(text, /^my_counter\{label="val"\} 1$/m);
});

test("HELP and TYPE headers are emitted once per metric name across multiple series", () => {
  incCounter("my_counter", "help.", { a: "x" });
  incCounter("my_counter", "help.", { a: "y" });
  const text = exportMetricsPrometheus();
  const helpMatches = [...text.matchAll(/^# HELP my_counter/gm)];
  assert.equal(helpMatches.length, 1);
  const typeMatches = [...text.matchAll(/^# TYPE my_counter counter/gm)];
  assert.equal(typeMatches.length, 1);
});

test("histogram renders bucket lines including +Inf, _sum, and _count", () => {
  observeHistogram("req_duration", "Duration.", API_DURATION_BUCKETS_MS, { route: "/api/test" }, 50);
  const text = exportMetricsPrometheus();

  assert.match(text, /^# HELP req_duration Duration\./m);
  assert.match(text, /^# TYPE req_duration histogram$/m);
  // +Inf bucket
  assert.match(text, /req_duration_bucket\{[^}]*le="\+Inf"[^}]*\} 1/m);
  // _sum and _count
  assert.match(text, /^req_duration_sum\{[^}]*\} 50$/m);
  assert.match(text, /^req_duration_count\{[^}]*\} 1$/m);
});

// ─── label escaping (tested directly on the escape function) ────────────────

test("escapePrometheusLabelValue: backslash → \\\\", () => {
  assert.equal(escapePrometheusLabelValue("a\\b"), "a\\\\b");
});

test("escapePrometheusLabelValue: newline → \\n", () => {
  assert.equal(escapePrometheusLabelValue("line1\nline2"), "line1\\nline2");
});

test('escapePrometheusLabelValue: double-quote → \\"', () => {
  assert.equal(escapePrometheusLabelValue('say "hi"'), 'say \\"hi\\"');
});

test("escapePrometheusLabelValue: combined escapes", () => {
  assert.equal(escapePrometheusLabelValue('path\\":\nend'), 'path\\\\\\":\\nend');
});

test("escapePrometheusLabelValue: safe chars pass through unchanged", () => {
  assert.equal(escapePrometheusLabelValue("safe_value-123"), "safe_value-123");
});

// ─── label key ordering ─────────────────────────────────────────────────────

test("label keys are emitted in sorted order", () => {
  incCounter("ordered_counter", "help.", { z: "last", a: "first", m: "middle" });
  const text = exportMetricsPrometheus();
  // Should find keys in alphabetical order: a, m, z
  assert.match(text, /\{a="first",m="middle",z="last"\}/);
});
