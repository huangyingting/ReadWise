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

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

const databaseUrl = process.env.DATABASE_URL ?? "file:./dev.db";
const log: Array<"error" | "warn"> = process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"];

function createPrismaClient(): PrismaClient {
  if (isPostgresDatabase()) {
    const url = new URL(databaseUrl);
    const schema = url.searchParams.get("schema") ?? undefined;

    return new PrismaClient({
      adapter: new PrismaPg(databaseUrl, schema ? { schema } : undefined),
      log,
    });
  }

  return new PrismaClient({
    adapter: new PrismaBetterSqlite3({ url: databaseUrl }),
    log,
  });
}

export const prisma =
  globalForPrisma.prisma ??
  createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
