/**
 * Client-safe helpers for the admin backfill form (#1186). Keeps parsing and the
 * endpoint contract pure so the client island can be verified without DOM.
 */

export const ADMIN_BACKFILL_ENDPOINT = "/api/admin/jobs/backfill";
export const MAX_BACKFILL_ARTICLE_IDS = 500;
export const MAX_BACKFILL_ARTICLE_ID_LENGTH = 200;

const ARTICLE_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export type ParsedArticleIds = {
  articleIds: string[];
  error: string | null;
};

/**
 * Parses a comma/newline separated article-id list, trims entries, de-dupes them,
 * and rejects values that cannot be Prisma/cuid-style identifiers.
 */
export function parseArticleIds(value: string): ParsedArticleIds {
  const raw = value
    .split(/[,\n\r]+/)
    .map((id) => id.trim())
    .filter(Boolean);
  const articleIds = Array.from(new Set(raw));

  if (articleIds.length > MAX_BACKFILL_ARTICLE_IDS) {
    return {
      articleIds,
      error: `Use ${MAX_BACKFILL_ARTICLE_IDS} or fewer article IDs per run.`,
    };
  }

  const invalid = articleIds.filter(
    (id) =>
      id.length > MAX_BACKFILL_ARTICLE_ID_LENGTH || !ARTICLE_ID_PATTERN.test(id),
  );
  if (invalid.length > 0) {
    return {
      articleIds,
      error:
        "Article IDs may only contain letters, numbers, underscores, and hyphens.",
    };
  }

  return { articleIds, error: null };
}
