import { NextResponse } from "next/server";
import { createPublicHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { isAiConfigured } from "@/lib/ai";
import { isSpeechConfigured } from "@/lib/speech";

// Prisma requires the Node.js runtime (uses native bindings).
export const runtime = "nodejs";

/**
 * GET /api/ready — readiness probe.
 * Checks DB connectivity via a trivial query and reports provider availability.
 * Returns 200 when all required systems (DB) are reachable, 503 otherwise.
 * Provider flags (AI, Speech) are informational — they don't affect the status
 * code because those providers degrade gracefully.
 */
export const GET = createPublicHandler({}, async () => {
  let dbStatus: "ok" | "error" = "ok";

  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    dbStatus = "error";
  }

  const ready = dbStatus === "ok";

  return NextResponse.json(
    {
      status: ready ? "ready" : "unavailable",
      timestamp: new Date().toISOString(),
      checks: {
        db: dbStatus,
        ai: isAiConfigured() ? "configured" : "unconfigured",
        speech: isSpeechConfigured() ? "configured" : "unconfigured",
      },
    },
    { status: ready ? 200 : 503 },
  );
});
