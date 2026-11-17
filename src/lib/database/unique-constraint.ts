/**
 * Unique-constraint (P2002) inspection that works across Prisma error shapes.
 *
 * Classic engines report the conflicting columns (or index name) in
 * `meta.target`; driver adapters (used in production) report them under
 * `meta.driverAdapterError.cause.constraint` as `fields` or `index` instead,
 * with quoted identifiers. Reading only `meta.target` silently misses every
 * adapter conflict, so callers that retry on a specific slot must use these
 * helpers.
 */
import { Prisma } from "@prisma/client";

type ConstraintMeta = {
  target?: unknown;
  driverAdapterError?: { cause?: { constraint?: { fields?: unknown; index?: unknown } } };
};

function asNames(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.map((entry) => String(entry));
  return [];
}

/**
 * Column (or index) names of a P2002 violation with identifier quotes removed,
 * or null when the error is not a unique-constraint violation.
 */
export function uniqueConstraintFields(error: unknown): string[] | null {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") return null;
  const meta = (error.meta ?? {}) as ConstraintMeta;
  const constraint = meta.driverAdapterError?.cause?.constraint;
  const names = [...asNames(meta.target), ...asNames(constraint?.fields), ...asNames(constraint?.index)];
  return names.map((name) => name.replace(/["`]/g, ""));
}

/** True for a P2002 whose columns or index name mention `field`. */
export function isUniqueConflictOn(error: unknown, field: string): boolean {
  return uniqueConstraintFields(error)?.some((name) => name.includes(field)) ?? false;
}
