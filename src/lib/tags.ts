import { prisma } from "@/lib/prisma";
import { ArticleVisibility, TagScope, type Article } from "@prisma/client";
import { getOrCreateArticleAi } from "@/lib/ai-cache";
import { htmlToPlainText } from "@/lib/translation";
import { boundedSampleForFeature } from "@/lib/ai/chunking";
import { validateTags } from "@/lib/ai/validation";
import { createCachedListing, ARTICLES_CACHE_TAG, TAGS_CACHE_TAG } from "@/lib/cache";
import { publicListableArticleWhere, type ArticleAccessContext } from "@/lib/article-access";

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

/** How many topic tags to request from the model. */
const TARGET_TAGS = 5;

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
 * Finds-or-creates a Tag by name (slug derived from the name). Tag names are
 * unique case-insensitively via their slug; an existing slug match is reused.
 */
function namespaceFor(scope: TagScope, ownerId?: string | null, orgId?: string | null): string {
  if (scope === TagScope.PRIVATE) return `user:${ownerId ?? "unknown"}`;
  if (scope === TagScope.ORG) return `org:${orgId ?? "unknown"}`;
  return "public";
}

function tagScopeForArticle(article: Pick<Article, "visibility" | "ownerId">): {
  scope: TagScope;
  ownerId: string | null;
  namespace: string;
} {
  if (article.visibility === ArticleVisibility.PRIVATE) {
    return {
      scope: TagScope.PRIVATE,
      ownerId: article.ownerId,
      namespace: namespaceFor(TagScope.PRIVATE, article.ownerId),
    };
  }
  return { scope: TagScope.PUBLIC, ownerId: null, namespace: namespaceFor(TagScope.PUBLIC) };
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
      readCache: async () => {
        const tags = await getArticleTags(articleId);
        return tags.length > 0 ? tags : null;
      },
      buildMessages: (article) => {
        const source = boundedSampleForFeature(htmlToPlainText(article.content), "tags");
        return [
          {
            role: "system",
            content:
              "You label news articles with topic tags for discovery. From the user's " +
              `article, choose up to ${TARGET_TAGS} concise topic tags (1-3 words each, ` +
              "Title Case, e.g. \"Climate Change\", \"Artificial Intelligence\"). Respond " +
              "ONLY with a JSON array of tag strings. No markdown, no commentary, JSON " +
              "array only.",
          },
          {
            role: "user",
            content: `Title: ${article.title}\n\n${source}`,
          },
        ];
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
  ["tags:articles-by-tag"],
  [ARTICLES_CACHE_TAG, TAGS_CACHE_TAG],
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
  ["tags:related-articles"],
  [ARTICLES_CACHE_TAG, TAGS_CACHE_TAG],
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
  ["tags:with-counts"],
  [ARTICLES_CACHE_TAG, TAGS_CACHE_TAG],
);
