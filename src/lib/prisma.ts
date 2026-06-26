/**
 * Prisma client singleton and shared DB utilities.
 *
 * @server-only — Must never be imported from a "use client" file or any module
 * that can enter a client bundle. See docs/refactoring.md § REF-076.
 */
import { PrismaClient } from "@prisma/client";

export { isPostgresDatabase } from "@/lib/db-utils";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
