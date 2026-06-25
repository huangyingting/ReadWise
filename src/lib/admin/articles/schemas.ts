/**
 * Feature-owned schema module for admin article routes (REF-043).
 * Exports body schemas, query parsers, and inferred TypeScript types so both
 * route handlers and tests can import the contracts directly.
 */

import {
  object,
  nonEmptyString,
  optional,
  string,
  oneOf,
  array,
  queryString,
  queryInt,
  type Schema,
  type ValidationResult,
} from "@/lib/validation";
import { ARTICLE_STATUSES } from "@/lib/article-access";
import { REVIEW_STATES, type ReviewState } from "@/lib/content-review";
import { TAKEDOWN_STATES, type TakedownState } from "@/lib/content-policy";

/** Helper: extract the validated value type from any Schema<T>. */
type InferSchema<S extends Schema<unknown>> = S extends Schema<infer T> ? T : never;

// ---------------------------------------------------------------------------
// POST /api/admin/articles/ingest
// ---------------------------------------------------------------------------

export const ingestBody = object({ url: nonEmptyString(2000) });

export type IngestBody = InferSchema<typeof ingestBody>;

// ---------------------------------------------------------------------------
// GET /api/admin/articles — search/list
// ---------------------------------------------------------------------------

type ArticleStatus = (typeof ARTICLE_STATUSES)[number];

export type ArticlesAdminQuery = {
  query: string;
  status: ArticleStatus | null;
  page: number;
};

const MAX_Q_LENGTH = 200;
const MAX_PAGE = 10_000;

export function parseAdminArticlesQuery(
  params: URLSearchParams,
): ValidationResult<ArticlesAdminQuery> {
  const q = queryString(params, "q");
  if (q.length > MAX_Q_LENGTH) {
    return { ok: false, error: `q must be at most ${MAX_Q_LENGTH} characters` };
  }

  const rawStatus = params.get("status") ?? "";
  let status: ArticleStatus | null = null;
  if (rawStatus !== "") {
    const normalizedStatus = rawStatus.toUpperCase();
    if (!(ARTICLE_STATUSES as readonly string[]).includes(normalizedStatus)) {
      return {
        ok: false,
        error: `status must be one of: ${ARTICLE_STATUSES.join(", ")}`,
      };
    }
    status = normalizedStatus as ArticleStatus;
  }

  const page = queryInt(params, "page", { fallback: 1, min: 1, max: MAX_PAGE });

  return { ok: true, value: { query: q, status, page } };
}

// ---------------------------------------------------------------------------
// POST /api/admin/articles/[id]/review
// ---------------------------------------------------------------------------

export const reviewBody = object({
  title: optional(nonEmptyString(500)),
  excerpt: optional(string({ max: 2000 })),
  category: optional(string({ max: 100 })),
  difficulty: optional(string({ max: 10 })),
  status: optional(oneOf(["DRAFT", "PUBLISHED"] as const)),
  reviewState: optional(oneOf<ReviewState>(REVIEW_STATES)),
  qualityFlags: optional(array(nonEmptyString(50), { max: 20 })),
  tags: optional(array(nonEmptyString(60), { max: 25 })),
  note: optional(string({ max: 2000 })),
});

export type ReviewBody = InferSchema<typeof reviewBody>;

// ---------------------------------------------------------------------------
// POST /api/admin/articles/[id]/takedown
// ---------------------------------------------------------------------------

export const takedownBody = object({
  state: oneOf<TakedownState>(TAKEDOWN_STATES),
  note: optional(string({ max: 2000 })),
  rightsNote: optional(string({ max: 2000 })),
});

export type TakedownBody = InferSchema<typeof takedownBody>;
