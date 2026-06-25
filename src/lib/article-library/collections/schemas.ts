/**
 * Feature-owned schema module for bookmark routes (REF-043).
 * Exports body schemas, query parsers, and inferred TypeScript types for both
 * route handlers and tests to import directly.
 */

import {
  object,
  nonEmptyString,
  queryString,
  type Schema,
  type ValidationResult,
} from "@/lib/validation";

/** Helper: extract the validated value type from any Schema<T>. */
type InferSchema<S extends Schema<unknown>> = S extends Schema<infer T> ? T : never;

// ---------------------------------------------------------------------------
// POST /api/bookmarks/toggle
// ---------------------------------------------------------------------------

export const toggleBookmarkBody = object({ articleId: nonEmptyString(200) });

export type ToggleBookmarkBody = InferSchema<typeof toggleBookmarkBody>;

// ---------------------------------------------------------------------------
// GET /api/bookmarks/membership?articleId=<id>
// ---------------------------------------------------------------------------

export type MembershipQuery = { articleId: string };

export function parseMembershipQuery(
  params: URLSearchParams,
): ValidationResult<MembershipQuery> {
  const articleId = queryString(params, "articleId");
  if (!articleId) return { ok: false as const, error: "articleId is required" };
  return { ok: true as const, value: { articleId } };
}