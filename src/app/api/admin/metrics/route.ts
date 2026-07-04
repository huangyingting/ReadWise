import { exportMetricsPrometheus } from "@/lib/metrics";
import { createAdminHandler } from "@/lib/api-handler";
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

export const GET = createAdminHandler({}, async () => {
  await refreshJobQueueDepthMetrics();
  return prometheusResponse(exportMetricsPrometheus());
});
