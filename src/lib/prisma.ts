/**
 * Prisma client singleton and shared DB utilities.
 *
 * @server-only — Must never be imported from a "use client" file or any module
 * that can enter a client bundle. See ADR-0010.
 */
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

import { isPostgresDatabase } from "@/lib/db-utils";
import {
  assertProductionPrismaSchemaMatchesDatabase,
  databaseProviderFromUrl,
  databaseUrlForPrismaAdapter,
  dbQueryTimingEnabled,
  dbSlowQueryThresholdMs,
} from "@/lib/runtime-config/database";
import { instrumentPrismaClient } from "@/lib/prisma-instrumentation";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

const databaseUrl = databaseUrlForPrismaAdapter(process.env.DATABASE_URL ?? "file:./dev.db");
const prismaLogLevels: Array<"error" | "warn"> =
  process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"];

function postgresSchema(databaseUrl: string): string | undefined {
  const url = new URL(databaseUrl);
  return url.searchParams.get("schema") ?? undefined;
}

function createPostgresPrismaClient(databaseUrl: string): PrismaClient {
  const schema = postgresSchema(databaseUrl);

  return new PrismaClient({
    adapter: new PrismaPg(databaseUrl, schema ? { schema } : undefined),
    log: prismaLogLevels,
  });
}

function createSqlitePrismaClient(databaseUrl: string): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaBetterSqlite3({ url: databaseUrl }),
    log: prismaLogLevels,
  });
}

function createPrismaClient(): PrismaClient {
  assertProductionPrismaSchemaMatchesDatabase();

  const client = isPostgresDatabase()
    ? createPostgresPrismaClient(databaseUrl)
    : createSqlitePrismaClient(databaseUrl);

  return instrumentPrismaClient(client, {
    enabled: dbQueryTimingEnabled(),
    provider: databaseProviderFromUrl(databaseUrl) ?? "unknown",
    slowThresholdMs: dbSlowQueryThresholdMs(),
  });
}

export const prisma =
  globalForPrisma.prisma ??
  createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
