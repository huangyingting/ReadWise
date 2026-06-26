/**
 * Shared database utility helpers (BE-4).
 *
 * Thin, import-free helpers that all layers can use without pulling in the
 * Prisma client singleton. Keeping these separate from `@/lib/prisma` ensures
 * test mocks of `prisma` don't accidentally shadow them.
 *
 * @server-only — Must never be imported from a "use client" file or any module
 * that can enter a client bundle.
 */

/**
 * Returns true when the active database URL targets PostgreSQL.
 * Single canonical implementation — all modules import from here (BE-4).
 */
export function isPostgresDatabase(): boolean {
  const url = process.env.DATABASE_URL ?? "";
  return url.startsWith("postgresql://") || url.startsWith("postgres://");
}
