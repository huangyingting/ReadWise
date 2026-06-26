/**
 * Database infrastructure configuration (server-only).
 *
 * Provides typed helpers for database-related operational config that callers
 * should not read directly from process.env.
 *
 * @server-only — Must never be imported from a "use client" file.
 */
import { isAbsolute, join } from "node:path";
import { envValue } from "@/lib/runtime-config/env";

/**
 * Returns the absolute path to the Prisma schema file.
 *
 * Reads `PRISMA_SCHEMA_PATH` (defaults to `"prisma/schema.prisma"`).
 * Resolves relative paths against `process.cwd()`.
 */
export function prismaSchemaPath(): string {
  const configured = envValue("PRISMA_SCHEMA_PATH") ?? "prisma/schema.prisma";
  return isAbsolute(configured) ? configured : join(process.cwd(), configured);
}
