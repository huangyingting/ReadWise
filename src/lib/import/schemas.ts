/**
 * Feature-owned schema module for the article import routes (REF-043).
 * Exports body schemas, query parsers, and their inferred TypeScript types so
 * both route handlers and tests can import the contracts directly.
 */

import {
  object,
  nonEmptyString,
  optional,
  string,
  queryInt,
  type Schema,
} from "@/lib/validation";
import { MAX_TEXT_BYTES } from "@/lib/import";
import { IMPORTS_PAGE_SIZE, IMPORTS_MAX_LIMIT } from "@/lib/article-library";

/** Helper: extract the validated value type from any Schema<T>. */
type InferSchema<S extends Schema<unknown>> = S extends Schema<infer T> ? T : never;

// ---------------------------------------------------------------------------
// POST /api/articles/import
// ---------------------------------------------------------------------------

export const importBody = object({
  url: optional(nonEmptyString(2000)),
  title: optional(nonEmptyString(500)),
  text: optional(string({ min: 0, max: MAX_TEXT_BYTES })),
});

export type ImportBody = InferSchema<typeof importBody>;

// ---------------------------------------------------------------------------
// GET /api/articles/import
// ---------------------------------------------------------------------------

export type ImportsListQuery = { offset: number; limit: number };

export function parseListQuery(
  params: URLSearchParams,
): { ok: true; value: ImportsListQuery } {
  return {
    ok: true as const,
    value: {
      offset: queryInt(params, "offset", { fallback: 0, min: 0 }),
      limit: queryInt(params, "limit", {
        fallback: IMPORTS_PAGE_SIZE,
        min: 1,
        max: IMPORTS_MAX_LIMIT,
      }),
    },
  };
}
