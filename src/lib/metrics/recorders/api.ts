/**
 * API request metrics recorder.
 *
 * Records per-route-group request counts and latency histograms. Route paths
 * are normalised through routeGroupFromPath so raw article/user ids never
 * become metric labels.
 */

import { API_DURATION_BUCKETS_MS, incCounter, observeHistogram, statusClass } from "@/lib/metrics/registry";
import { routeGroupFromPath } from "@/lib/metrics/route-groups";

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;
const API_REQUESTS_TOTAL = {
  name: "readwise_api_requests_total",
  help: "Total API responses by route group and status.",
} as const;
const API_REQUEST_DURATION_MS = {
  name: "readwise_api_request_duration_ms",
  help: "API response latency in milliseconds.",
} as const;

type ApiRequestInput = {
  method: string;
  route: string;
  status: number;
  durationMs: number;
};

type ApiRequestLabels = {
  method: string;
  route: string;
  status: string;
  status_class: string;
};

function isKnownHttpMethod(method: string): boolean {
  return (HTTP_METHODS as readonly string[]).includes(method);
}

function normalizeMethod(method: string): string {
  const upper = method.toUpperCase();
  return isKnownHttpMethod(upper) ? upper : "OTHER";
}

function apiRequestLabels(input: ApiRequestInput): ApiRequestLabels {
  return {
    method: normalizeMethod(input.method),
    route: routeGroupFromPath(input.route),
    status: String(input.status),
    status_class: statusClass(input.status),
  };
}

function apiDurationLabels(labels: ApiRequestLabels) {
  return { method: labels.method, route: labels.route, status_class: labels.status_class };
}

export function recordApiRequest(input: ApiRequestInput): void {
  const labels = apiRequestLabels(input);
  incCounter(API_REQUESTS_TOTAL.name, API_REQUESTS_TOTAL.help, labels);
  observeHistogram(
    API_REQUEST_DURATION_MS.name,
    API_REQUEST_DURATION_MS.help,
    API_DURATION_BUCKETS_MS,
    apiDurationLabels(labels),
    input.durationMs,
  );
}
