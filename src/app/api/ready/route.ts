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

type CheckStatus = "ok" | "error";

type MigrationHealth = {
  status: CheckStatus;
  pending: number;
  unfinished: number;
  unappliedNames: string[];
};

const MIGRATIONS_QUERY =
  'SELECT migration_name, finished_at FROM "_prisma_migrations" WHERE rolled_back_at IS NULL';

const FAILED_MIGRATION_HEALTH: MigrationHealth = {
  status: "error",
  pending: 0,
  unfinished: 0,
  unappliedNames: [],
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

async function checkDatabase(): Promise<CheckStatus> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return "ok";
  } catch {
    return "error";
  }
}

async function checkMigrations(): Promise<MigrationHealth> {
  try {
    const rows = await prisma.$queryRawUnsafe<MigrationRow[]>(MIGRATIONS_QUERY);
    const repositoryMigrations = await listRepositoryMigrationNames();
    const trackedMigrations = new Set(rows.map((row) => row.migration_name));
    const unfinished = rows.filter((row) => !row.finished_at).length;
    const unappliedNames = repositoryMigrations.filter((name) => !trackedMigrations.has(name));
    const pending = unfinished + unappliedNames.length;

    return {
      status: pending > 0 ? "error" : "ok",
      pending,
      unfinished,
      unappliedNames,
    };
  } catch {
    return FAILED_MIGRATION_HEALTH;
  }
}

/**
 * GET /api/ready — readiness probe.
 * Checks only local dependencies: runtime config, DB connectivity and Prisma
 * migration-table health. Optional providers are reported as degraded when
 * missing or partial, but they don't affect the status code because those
 * features intentionally degrade gracefully. No external provider calls happen.
 */
export const GET = createPublicHandler({}, async () => {
  const dbStatus = await checkDatabase();
  const migrationHealth =
    dbStatus === "ok" ? await checkMigrations() : FAILED_MIGRATION_HEALTH;
  const config = validateRuntimeConfig();
  const ready = dbStatus === "ok" && migrationHealth.status === "ok" && config.ready;

  return NextResponse.json(
    {
      status: ready ? "ready" : "unavailable",
      timestamp: new Date().toISOString(),
      checks: {
        db: dbStatus,
        migrations: migrationHealth.status,
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
        pending: migrationHealth.pending,
        unfinished: migrationHealth.unfinished,
        unapplied: migrationHealth.unappliedNames.length,
        unappliedNames: migrationHealth.unappliedNames,
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
