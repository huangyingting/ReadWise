import { NextResponse } from "next/server";
import { createPublicHandler } from "@/lib/api-handler";

const HEALTH_STATUS = "ok" as const;

function healthPayload() {
  return { status: HEALTH_STATUS, timestamp: new Date().toISOString() };
}

/**
 * GET /api/health — liveness probe.
 * Cheap: no DB, no external calls. Returns 200 always so a load balancer or
 * container orchestrator can confirm the process is alive and responding.
 */
export const GET = createPublicHandler({}, () => {
  return NextResponse.json(healthPayload());
});
