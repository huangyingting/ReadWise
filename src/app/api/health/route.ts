import { NextResponse } from "next/server";
import { createPublicHandler } from "@/lib/api-handler";

/**
 * GET /api/health — liveness probe.
 * Cheap: no DB, no external calls. Returns 200 always so a load balancer or
 * container orchestrator can confirm the process is alive and responding.
 */
export const GET = createPublicHandler({}, () => {
  return NextResponse.json({ status: "ok", timestamp: new Date().toISOString() });
});
