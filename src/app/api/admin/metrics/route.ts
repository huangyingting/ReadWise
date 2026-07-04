import { exportMetricsPrometheus } from "@/lib/metrics";
import { createCapabilityHandler } from "@/lib/api-handler";
import { CAPABILITIES } from "@/lib/rbac";
import { refreshJobQueueDepthMetrics } from "@/lib/jobs/metrics";

const PROMETHEUS_HEADERS = {
  "content-type": "text/plain; version=0.0.4; charset=utf-8",
  "cache-control": "no-store",
};

function prometheusResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: PROMETHEUS_HEADERS,
  });
}

export const GET = createCapabilityHandler(
  CAPABILITIES.securityView,
  {}, async () => {
  await refreshJobQueueDepthMetrics();
  return prometheusResponse(exportMetricsPrometheus());
});
