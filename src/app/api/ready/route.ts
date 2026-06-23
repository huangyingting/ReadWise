import { NextResponse } from "next/server";
import { createPublicHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { validateRuntimeConfig } from "@/lib/config";

// Prisma requires the Node.js runtime (uses native bindings).
export const runtime = "nodejs";

/**
 * GET /api/ready — readiness probe.
 * Checks only local dependencies: runtime config, DB connectivity and Prisma
 * migration-table health. Optional providers are reported as degraded when
 * missing or partial, but they don't affect the status code because those
 * features intentionally degrade gracefully. No external provider calls happen.
 */
export const GET = createPublicHandler({}, async () => {
  let dbStatus: "ok" | "error" = "ok";
  let migrationStatus: "ok" | "error" = "ok";
  let migrationPending = 0;

  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    dbStatus = "error";
  }

  if (dbStatus === "ok") {
    try {
      const rows = await prisma.$queryRawUnsafe<Array<{ pending: bigint | number }>>(
        'SELECT COUNT(*) AS pending FROM "_prisma_migrations" WHERE rolled_back_at IS NULL AND finished_at IS NULL',
      );
      migrationPending = Number(rows[0]?.pending ?? 0);
      if (migrationPending > 0) {
        migrationStatus = "error";
      }
    } catch {
      migrationStatus = "error";
    }
  } else {
    migrationStatus = "error";
  }

  const config = validateRuntimeConfig();
  const ready = dbStatus === "ok" && migrationStatus === "ok" && config.ready;

  return NextResponse.json(
    {
      status: ready ? "ready" : "unavailable",
      timestamp: new Date().toISOString(),
      checks: {
        db: dbStatus,
        migrations: migrationStatus,
        config: config.ready ? "ok" : "error",
        providers: {
          ai: config.optional.ai.status,
          speech: config.optional.speech.status,
          push: config.optional.push.status,
          googleOAuth: config.optional.googleOAuth.status,
          azureAdOAuth: config.optional.azureAdOAuth.status,
        },
      },
      migrations: { pending: migrationPending },
      config: {
        required: config.required,
        optional: config.optional,
        tuning: config.tuning,
        errors: config.errors,
        warnings: config.warnings,
      },
    },
    { status: ready ? 200 : 503 },
  );
});
