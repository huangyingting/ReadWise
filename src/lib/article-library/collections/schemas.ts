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

const ARTICLE_ID_FIELD = "articleId";
const ARTICLE_ID_REQUIRED_ERROR = "articleId is required";

function requiredQueryString(
  params: URLSearchParams,
  field: string,
  requiredError: string,
): ValidationResult<string> {
  const value = queryString(params, field);
  if (!value) return { ok: false as const, error: requiredError };
  return { ok: true as const, value };
}

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
  const articleId = requiredQueryString(params, ARTICLE_ID_FIELD, ARTICLE_ID_REQUIRED_ERROR);
  if (!articleId.ok) return articleId;
  return { ok: true as const, value: { articleId: articleId.value } };
}
