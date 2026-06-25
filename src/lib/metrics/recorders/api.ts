/**
 * API request metrics recorder.
 *
 * Records per-route-group request counts and latency histograms. Route paths
 * are normalised through routeGroupFromPath so raw article/user ids never
 * become metric labels.
 */

import { incCounter, observeHistogram, statusClass, API_DURATION_BUCKETS_MS } from "@/lib/metrics/registry";
import { routeGroupFromPath } from "@/lib/metrics/route-groups";

function normalizeMethod(method: string): string {
  const upper = method.toUpperCase();
  return /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(upper) ? upper : "OTHER";
}

export function recordApiRequest(input: {
  method: string;
  route: string;
  status: number;
  durationMs: number;
}): void {
  const labels = {
    method: normalizeMethod(input.method),
    route: routeGroupFromPath(input.route),
    status: String(input.status),
    status_class: statusClass(input.status),
  };
  incCounter("readwise_api_requests_total", "Total API responses by route group and status.", labels);
  observeHistogram(
    "readwise_api_request_duration_ms",
    "API response latency in milliseconds.",
    API_DURATION_BUCKETS_MS,
    { method: labels.method, route: labels.route, status_class: labels.status_class },
    input.durationMs,
  );
}
