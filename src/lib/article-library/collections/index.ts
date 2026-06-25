/**
 * Article collections — taxonomy/tags and reading-list/bookmarks
 * (article-library subsystem, REF-040, REF-042).
 *
 * Tag scope rules are security-sensitive: private imports must not leak into
 * public tag namespaces. All public tag queries are restricted to PUBLIC-scope
 * tags on public-listable articles via {@link publicListableArticleWhere}.
 *
 * Reading-list/bookmark logic is split into focused sub-modules (REF-042):
 *   default-list-policy  — DEFAULT_LIST_NAME and lazy-upsert for "Saved"
 *   commands             — createList, renameList, deleteList, addToList,
 *                          removeFromList, toggleBookmark
 *   read-models          — getUserLists, getListWithArticles,
 *                          getBookmarkedArticleIds
 *   membership           — getArticleListMembership
 */
import { prisma } from "@/lib/prisma";
import { TagScope, type Article } from "@prisma/client";
import { getOrCreateArticleAi } from "@/lib/ai-cache";
import { htmlToPlainText } from "@/lib/content-pipeline";
import { boundedSampleForFeature } from "@/lib/ai/chunking";
import { renderPrompt, promptModelParams, TARGET_TAGS } from "@/lib/ai/prompts";
import { validateTags } from "@/lib/ai/output/validators";
import { createCachedListing } from "@/lib/cache";
import { LISTING_KEYS, LISTING_TAGS } from "@/lib/listing-cache";
import { publicListableArticleWhere, type ArticleAccessContext } from "../policy";
import { slugifyTag, tagScopeForArticle } from "@/lib/taxonomy/scope";

// Re-export so existing consumers (admin-tags, tests, routes) keep working.
export { slugifyTag } from "@/lib/taxonomy/scope";

// ---------------------------------------------------------------------------
// Taxonomy / tags
// ---------------------------------------------------------------------------

export type TagView = {
  id: string;
  name: string;
  slug: string;
  scope: TagScope;
};

export type ArticleTagsResult = {
  articleId: string;
  tags: TagView[];
  fallback: boolean;
};

/**
 * Parses the model's JSON response into a deduped list of Title-Cased tag names
 * via the shared strict validator (RW-024): tolerant of code fences/prose,
 * rejects empties and dedups by slug. Returns [] when nothing usable is found.
 */
export function parseTagsJson(raw: string): string[] {
  return validateTags(raw, slugifyTag).items;
}

function toView(tag: { id: string; name: string; slug: string; scope: TagScope }): TagView {
  return { id: tag.id, name: tag.name, slug: tag.slug, scope: tag.scope };
}

/** Reads an article's currently-stored tags, alphabetically by name. */
export async function getArticleTags(articleId: string): Promise<TagView[]> {
  const rows = await prisma.articleTag.findMany({
    where: { articleId },
    orderBy: { tag: { name: "asc" } },
    select: { tag: { select: { id: true, name: true, slug: true, scope: true } } },
  });
  return rows.map((r) => toView(r.tag));
}

/**
 * Finds-or-creates a Tag inside a scoped namespace. Public library tags are
 * global (`PUBLIC/public`); private import tags are per-owner (`PRIVATE/user:id`).
 * The same slug can therefore exist privately without leaking into public tag
 * listings or claiming a global tag name.
 */
async function upsertTag(
  name: string,
  scope: TagScope,
  ownerId: string | null,
  namespace: string,
): Promise<{ id: string; name: string; slug: string; scope: TagScope }> {
  const slug = slugifyTag(name);
  const existing = await prisma.tag.findUnique({
    where: { scope_namespace_slug: { scope, namespace, slug } },
  });
  if (existing) {
    return existing;
  }
  return prisma.tag.upsert({
    where: { scope_namespace_slug: { scope, namespace, slug } },
    update: {},
    create: { name: name.trim(), slug, scope, namespace, ownerId },
  });
}

/**
 * Returns the article's tags, auto-extracting them via the AI provider on a
 * cache miss (an article with no tags yet). When AI is unconfigured or the
 * request yields nothing, returns an empty list flagged as a fallback and
 * persists nothing (so real tags can be generated later).
 */
export async function getOrCreateArticleTags(
  articleId: string,
  context?: ArticleAccessContext | null,
): Promise<ArticleTagsResult | null> {
  return getOrCreateArticleAi<
    { title: string; content: string },
    string[],
    TagView[],
    ArticleTagsResult
  >(
    articleId,
    {
      feature: "tags",
      maxOutputTokens: promptModelParams("tags").maxOutputTokens,
      readCache: async () => {
        const tags = await getArticleTags(articleId);
        return tags.length > 0 ? tags : null;
      },
      buildMessages: (article) => {
        const source = boundedSampleForFeature(htmlToPlainText(article.content), "tags");
        return renderPrompt("tags", { title: article.title, source });
      },
      parse: (completion) => parseTagsJson(completion).slice(0, TARGET_TAGS),
      isEmpty: (names) => names.length === 0,
      persist: async (id, names) => {
        const article = await prisma.article.findUnique({
          where: { id },
          select: { visibility: true, ownerId: true },
        });
        if (!article) return [];
        const tagScope = tagScopeForArticle(article);
        for (const name of names) {
          const tag = await upsertTag(name, tagScope.scope, tagScope.ownerId, tagScope.namespace);
          await prisma.articleTag.upsert({
            where: { articleId_tagId: { articleId: id, tagId: tag.id } },
            update: {},
            create: { articleId: id, tagId: tag.id },
          });
        }
        return getArticleTags(id);
      },
      toResult: (tags) => ({ articleId, tags, fallback: false }),
      fallback: () => ({ articleId, tags: [], fallback: true }),
    },
    context,
  );
}

/**
 * Replaces an article's tag links with the given tag names (admin moderation —
 * RW-048). Names are slugified + de-duped (blanks dropped); tags are upserted
 * into the article's scope/namespace and the `ArticleTag` links are reconciled
 * (added/removed) so the final set matches exactly. Returns the resulting tags,
 * or null for an unknown article id.
 */
export async function setArticleTags(
  articleId: string,
  tagNames: string[],
): Promise<TagView[] | null> {
  const article = await prisma.article.findUnique({
    where: { id: articleId },
    select: { visibility: true, ownerId: true },
  });
  if (!article) return null;

  const scope = tagScopeForArticle(article);

  const seen = new Set<string>();
  const names: string[] = [];
  for (const raw of tagNames) {
    const slug = slugifyTag(raw ?? "");
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    names.push(raw.trim());
  }

  const desiredTagIds = new Set<string>();
  for (const name of names) {
    const tag = await upsertTag(name, scope.scope, scope.ownerId, scope.namespace);
    desiredTagIds.add(tag.id);
  }

  const existingLinks = await prisma.articleTag.findMany({
    where: { articleId },
    select: { tagId: true },
  });
  const existingIds = new Set(existingLinks.map((link) => link.tagId));

  const toAdd = [...desiredTagIds].filter((id) => !existingIds.has(id));
  const toRemove = [...existingIds].filter((id) => !desiredTagIds.has(id));

  if (toRemove.length) {
    await prisma.articleTag.deleteMany({
      where: { articleId, tagId: { in: toRemove } },
    });
  }
  for (const tagId of toAdd) {
    await prisma.articleTag.create({ data: { articleId, tagId } });
  }

  return getArticleTags(articleId);
}

/** A tag plus the count of published articles carrying it. */
export type TagWithCount = TagView & { articleCount: number };

/** Looks up a single tag by its slug. */
export async function getTagBySlug(slug: string): Promise<TagView | null> {
  const tag = await prisma.tag.findFirst({
    where: {
      slug,
      scope: TagScope.PUBLIC,
      articles: { some: { article: publicListableArticleWhere() } },
    },
    select: { id: true, name: true, slug: true, scope: true },
  });
  return tag ? toView(tag) : null;
}

/**
 * Returns published articles carrying the given tag slug, newest first.
 * Returns [] when the tag does not exist.
 */
export function listArticlesByTag(slug: string, limit = 24): Promise<Article[]> {
  return cachedListArticlesByTag(slug, limit);
}

function listArticlesByTagUncached(slug: string, limit = 24): Promise<Article[]> {
  return prisma.article.findMany({
    where: publicListableArticleWhere({ tags: { some: { tag: { slug, scope: TagScope.PUBLIC } } } }),
    orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
    take: limit,
  });
}

const cachedListArticlesByTag = createCachedListing(
  listArticlesByTagUncached,
  LISTING_KEYS.articlesByTag,
  LISTING_TAGS.articlesAndTags,
);

/**
 * Returns published articles related to the given article, ranked by how many
 * tags they share with it (most overlap first, then newest). The source article
 * is excluded and results are de-duplicated and limited. Returns [] when the
 * article has no tags or nothing else shares them.
 */
export function listRelatedArticles(
  articleId: string,
  limit = 6,
): Promise<Article[]> {
  return cachedListRelatedArticles(articleId, limit);
}

async function listRelatedArticlesUncached(
  articleId: string,
  limit = 6,
): Promise<Article[]> {
  const ownTags = await prisma.articleTag.findMany({
    where: { articleId, tag: { scope: TagScope.PUBLIC } },
    select: { tagId: true },
  });
  const tagIds = ownTags.map((t) => t.tagId);
  if (tagIds.length === 0) {
    return [];
  }

  const links = await prisma.articleTag.findMany({
    where: {
      tagId: { in: tagIds },
      articleId: { not: articleId },
      article: publicListableArticleWhere(),
      tag: { scope: TagScope.PUBLIC },
    },
    select: { articleId: true },
  });

  const overlap = new Map<string, number>();
  for (const link of links) {
    overlap.set(link.articleId, (overlap.get(link.articleId) ?? 0) + 1);
  }
  if (overlap.size === 0) {
    return [];
  }

  const candidateIds = [...overlap.keys()];
  const articles = await prisma.article.findMany({
    where: publicListableArticleWhere({ id: { in: candidateIds } }),
  });

  return articles
    .sort((a, b) => {
      const byOverlap = (overlap.get(b.id) ?? 0) - (overlap.get(a.id) ?? 0);
      if (byOverlap !== 0) {
        return byOverlap;
      }
      const aDate = (a.publishedAt ?? a.createdAt).getTime();
      const bDate = (b.publishedAt ?? b.createdAt).getTime();
      return bDate - aDate;
    })
    .slice(0, limit);
}

const cachedListRelatedArticles = createCachedListing(
  listRelatedArticlesUncached,
  LISTING_KEYS.relatedArticles,
  LISTING_TAGS.articlesAndTags,
);

/** All tags that have at least one published article, with their counts. */
export function listTagsWithCounts(): Promise<TagWithCount[]> {
  return cachedListTagsWithCounts();
}

async function listTagsWithCountsUncached(): Promise<TagWithCount[]> {
  const tags = await prisma.tag.findMany({
    where: { scope: TagScope.PUBLIC },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      slug: true,
      scope: true,
      _count: {
        select: { articles: { where: { article: publicListableArticleWhere() } } },
      },
    },
  });
  return tags
    .map((t) => ({ id: t.id, name: t.name, slug: t.slug, scope: t.scope, articleCount: t._count.articles }))
    .filter((t) => t.articleCount > 0);
}

const cachedListTagsWithCounts = createCachedListing(
  listTagsWithCountsUncached,
  LISTING_KEYS.tagsWithCounts,
  LISTING_TAGS.articlesAndTags,
);

// ---------------------------------------------------------------------------
// Reading lists / bookmarks — re-exported from focused sub-modules (REF-042)
// ---------------------------------------------------------------------------
export * from "./default-list-policy";
export * from "./read-models";
export * from "./commands";
export * from "./membership";
