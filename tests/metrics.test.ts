import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  exportMetricsPrometheus,
  getMetricsSnapshot,
  recordAiCall,
  recordApiRequest,
  recordCacheAccess,
  recordCacheLookup,
  recordCacheMiss,
  recordContentProcessingRun,
  recordContentProcessingStep,
  recordWorkerJob,
  resetMetrics,
  routeGroupFromPath,
} from "@/lib/metrics";

beforeEach(() => {
  resetMetrics();
});

function counterValue(name: string, labels: Record<string, string>): number {
  const point = getMetricsSnapshot().counters.find((candidate) => {
    if (candidate.name !== name) return false;
    return Object.entries(labels).every(([key, value]) => candidate.labels[key] === value);
  });
  return point?.value ?? 0;
}

test("routeGroupFromPath replaces dynamic segments", () => {
  assert.equal(routeGroupFromPath("/api/reader/cma1234567890abcdef/progress"), "/api/reader/[id]/progress");
  assert.equal(routeGroupFromPath("/api/admin/articles/550e8400-e29b-41d4-a716-446655440000/rebuild"), "/api/admin/articles/[id]/rebuild");
  assert.equal(routeGroupFromPath("/api/admin/articles/ingest"), "/api/admin/articles/ingest");
  assert.equal(routeGroupFromPath("/api/lists/list-id-short/items/a1"), "/api/lists/[id]/items/[id]");
  assert.equal(routeGroupFromPath("/dashboard/abc"), "/other");
});

test("records and exports low-cardinality API metrics", () => {
  recordApiRequest({
    method: "post",
    route: "/api/reader/raw-article-id-123456/progress",
    status: 201,
    durationMs: 42,
  });

  assert.equal(
    counterValue("readwise_api_requests_total", {
      method: "post",
      route: "/api/reader/[id]/progress",
      status: "201",
      status_class: "2xx",
    }),
    1,
  );
  const text = exportMetricsPrometheus();
  assert.match(text, /readwise_api_requests_total/);
  assert.doesNotMatch(text, /raw-article-id-123456/);
});

test("records worker, AI, cache, and content processing counters", () => {
  recordWorkerJob({ outcome: "success", attempts: 2, published: true, durationMs: 125 });
  recordAiCall({
    feature: "quiz",
    outcome: "success",
    status: 200,
    durationMs: 300,
    promptTokens: 10,
    completionTokens: 4,
    totalTokens: 14,
  });
  recordCacheLookup("articles:published");
  recordCacheMiss("articles:published");
  recordCacheAccess("articles:published", "hit");
  recordContentProcessingStep({ step: "tags", status: "generated" });
  recordContentProcessingRun({ outcome: "success", published: true });

  assert.equal(counterValue("readwise_worker_jobs_total", { outcome: "success", published: "true" }), 1);
  assert.equal(counterValue("readwise_worker_job_attempts_total", { outcome: "success" }), 2);
  assert.equal(counterValue("readwise_ai_calls_total", { feature: "quiz", outcome: "success", status_class: "2xx" }), 1);
  assert.equal(counterValue("readwise_ai_tokens_total", { feature: "quiz", type: "total" }), 14);
  assert.equal(counterValue("readwise_cache_access_total", { cache: "articles:published", outcome: "miss" }), 1);
  assert.equal(counterValue("readwise_cache_access_total", { cache: "articles:published", outcome: "hit" }), 1);
  assert.equal(counterValue("readwise_content_processing_steps_total", { step: "tags", status: "generated" }), 1);
  assert.equal(
    counterValue("readwise_content_processing_runs_total", { outcome: "success", published: "true" }),
    1,
  );
});

test("resetMetrics clears all exported state", () => {
  recordApiRequest({ method: "GET", route: "/api/health", status: 200, durationMs: 1 });
  assert.ok(getMetricsSnapshot().counters.length > 0);
  resetMetrics();
  const snapshot = getMetricsSnapshot();
  assert.equal(snapshot.counters.length, 0);
  assert.equal(snapshot.histograms.length, 0);
  assert.equal(exportMetricsPrometheus(), "\n");
});
