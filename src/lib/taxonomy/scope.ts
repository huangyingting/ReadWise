/**
 * Taxonomy scope rules — pure helpers for slug normalisation, namespace
 * derivation, and article-visibility-to-tag-scope mapping.
 *
 * These rules are security-sensitive: private-import tags must never appear
 * in public tag namespaces or public listings. The helpers here are the single
 * source of truth consumed by AI tag generation (src/lib/tags.ts) and all tag
 * listing/read-model queries.
 *
 * No database access. No AI calls. Pure functions only.
 */

import { ArticleVisibility, TagScope, type Article } from "@prisma/client";

/** Storage namespace string used for all globally-public tags. */
export const PUBLIC_NAMESPACE = "public";

/**
 * Converts a free-form tag name into a URL-safe slug. Lowercases, strips
 * accents/punctuation, and collapses whitespace to single hyphens.
 */
export function slugifyTag(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Derives the storage namespace string for a given tag scope, owner, and org.
 *
 * - PUBLIC → `"public"` (shared global namespace)
 * - PRIVATE → `"user:<ownerId>"` (isolated per user; prevents private tags
 *   from claiming or leaking into global public slugs)
 * - ORG → `"org:<orgId>"` (reserved for future org-scoped tags)
 */
export function namespaceFor(
  scope: TagScope,
  ownerId?: string | null,
  orgId?: string | null,
): string {
  if (scope === TagScope.PRIVATE) return `user:${ownerId ?? "unknown"}`;
  if (scope === TagScope.ORG) return `org:${orgId ?? "unknown"}`;
  return PUBLIC_NAMESPACE;
}

/** Resolved scope metadata used when creating or looking up a tag. */
export type TagScopeInfo = {
  scope: TagScope;
  ownerId: string | null;
  namespace: string;
};

/**
 * Derives the tag scope, owner, and namespace for an article based on its
 * visibility.
 *
 * - PRIVATE article → `PRIVATE` scope, owner-namespaced (`user:<ownerId>`)
 * - All other articles → `PUBLIC` scope, global namespace (`"public"`)
 *
 * This mapping determines which tags an article may create and ensures that
 * private-import tags cannot appear in public tag pages or public counts.
 */
export function tagScopeForArticle(
  article: Pick<Article, "visibility" | "ownerId">,
): TagScopeInfo {
  if (article.visibility === ArticleVisibility.PRIVATE) {
    return {
      scope: TagScope.PRIVATE,
      ownerId: article.ownerId,
      namespace: namespaceFor(TagScope.PRIVATE, article.ownerId),
    };
  }
  return { scope: TagScope.PUBLIC, ownerId: null, namespace: PUBLIC_NAMESPACE };
}
