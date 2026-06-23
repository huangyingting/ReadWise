import { exportMetricsPrometheus } from "@/lib/metrics";
import { createAdminHandler } from "@/lib/api-handler";

export const GET = createAdminHandler({}, () => {
  return new Response(exportMetricsPrometheus(), {
    status: 200,
    headers: {
      "content-type": "text/plain; version=0.0.4; charset=utf-8",
      "cache-control": "no-store",
    },
  });
});
