import { readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { NextResponse } from "next/server";
import { createPublicHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { prismaSchemaPath } from "@/lib/runtime-config/database";
import { validateRuntimeConfig } from "@/lib/runtime-config/runtime";

// Prisma requires the Node.js runtime (uses native bindings).
export const runtime = "nodejs";

type MigrationRow = {
  migration_name: string;
  finished_at: Date | string | null;
};

async function listRepositoryMigrationNames(): Promise<string[]> {
  const schemaPath = prismaSchemaPath();
  const migrationDir = join(dirname(schemaPath), "migrations");
  const entries = await readdir(migrationDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

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
  let migrationUnfinished = 0;
  let unappliedMigrationNames: string[] = [];

  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    dbStatus = "error";
  }

  if (dbStatus === "ok") {
    try {
      const rows = await prisma.$queryRawUnsafe<MigrationRow[]>(
        'SELECT migration_name, finished_at FROM "_prisma_migrations" WHERE rolled_back_at IS NULL',
      );
      const repositoryMigrations = await listRepositoryMigrationNames();
      const trackedMigrations = new Set(rows.map((row) => row.migration_name));

      migrationUnfinished = rows.filter((row) => !row.finished_at).length;
      unappliedMigrationNames = repositoryMigrations.filter((name) => !trackedMigrations.has(name));
      migrationPending = migrationUnfinished + unappliedMigrationNames.length;
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
          storage: config.optional.storage.status,
        },
      },
      migrations: {
        pending: migrationPending,
        unfinished: migrationUnfinished,
        unapplied: unappliedMigrationNames.length,
        unappliedNames: unappliedMigrationNames,
      },
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
