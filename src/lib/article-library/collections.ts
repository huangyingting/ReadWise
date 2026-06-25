/**
 * Article collections — taxonomy/tags and reading-list/bookmarks
 * (article-library subsystem, REF-040).
 *
 * Tag scope rules are security-sensitive: private imports must not leak into
 * public tag namespaces. All public tag queries are restricted to PUBLIC-scope
 * tags on public-listable articles via {@link publicListableArticleWhere}.
 *
 * List operations are ownership-checked: callers supply both the list id and
 * the user id, and a missing-or-wrong-owner list always surfaces as a 404 so
 * IDOR is impossible.
 */
import { prisma } from "@/lib/prisma";
import { TagScope, type Article } from "@prisma/client";
import { getOrCreateArticleAi } from "@/lib/ai-cache";
import { htmlToPlainText } from "@/lib/translation";
import { boundedSampleForFeature } from "@/lib/ai/chunking";
import { renderPrompt, promptModelParams, TARGET_TAGS } from "@/lib/ai/prompts";
import { validateTags } from "@/lib/ai/output/validators";
import { createCachedListing, ARTICLES_CACHE_TAG, TAGS_CACHE_TAG } from "@/lib/cache";
import { publicListableArticleWhere, type ArticleAccessContext } from "./policy";
import { slugifyTag, tagScopeForArticle } from "@/lib/taxonomy/scope";
import { toListingArticle, type ListingArticle } from "./mapper";
import { getReadableArticleById } from "./policy";

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

// ---------------------------------------------------------------------------
// Reading lists / bookmarks
// ---------------------------------------------------------------------------

const DEFAULT_LIST_NAME = "Saved";

export type UserList = {
  id: string;
  name: string;
  isDefault: boolean;
  count: number;
};

export type ListWithArticles = {
  id: string;
  name: string;
  isDefault: boolean;
  articles: ListingArticle[];
};

type ErrResult = { ok: false; error: string; status: number };
type SimpleResult = { ok: true } | ErrResult;
type DataResult<T extends object> = ({ ok: true } & T) | ErrResult;

/**
 * Returns the user's default "Saved" list, creating it lazily if it does not
 * yet exist.
 */
export async function getOrCreateDefaultList(
  userId: string,
): Promise<{ id: string; name: string; isDefault: boolean }> {
  return prisma.readingList.upsert({
    where: { userId_name: { userId, name: DEFAULT_LIST_NAME } },
    create: { userId, name: DEFAULT_LIST_NAME, isDefault: true },
    update: {},
  });
}

/**
 * Returns all lists for a user, default list first, then oldest-first.
 * Each list includes the number of items it contains.
 */
export async function getUserLists(userId: string): Promise<UserList[]> {
  const rows = await prisma.readingList.findMany({
    where: { userId },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    include: { _count: { select: { items: true } } },
  });
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    isDefault: row.isDefault,
    count: row._count.items,
  }));
}

/**
 * Returns a list and its articles, ownership-checked. Returns `null` when the
 * list does not exist or belongs to a different user.
 */
export async function getListWithArticles(
  listId: string,
  userId: string,
): Promise<ListWithArticles | null> {
  const row = await prisma.readingList.findFirst({
    where: { id: listId, userId },
    include: {
      items: {
        orderBy: { addedAt: "desc" },
        include: { article: true },
      },
    },
  });
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    isDefault: row.isDefault,
    articles: row.items.map((item) => toListingArticle(item.article)),
  };
}

/** Creates a new (non-default) named list for the user. */
export async function createList(
  userId: string,
  name: string,
): Promise<{ id: string; name: string; isDefault: boolean }> {
  return prisma.readingList.create({
    data: { userId, name, isDefault: false },
  });
}

/** Renames a list. Ownership-checked; 404 if missing or not owned. */
export async function renameList(
  listId: string,
  userId: string,
  name: string,
): Promise<DataResult<{ list: { id: string; name: string } }>> {
  const existing = await prisma.readingList.findFirst({ where: { id: listId, userId } });
  if (!existing) return { ok: false, error: "List not found", status: 404 };
  const updated = await prisma.readingList.update({ where: { id: listId }, data: { name } });
  return { ok: true, list: { id: updated.id, name: updated.name } };
}

/**
 * Deletes a list. Ownership-checked. Refuses (409) to delete the default list.
 */
export async function deleteList(
  listId: string,
  userId: string,
): Promise<SimpleResult> {
  const existing = await prisma.readingList.findFirst({ where: { id: listId, userId } });
  if (!existing) return { ok: false, error: "List not found", status: 404 };
  if (existing.isDefault) {
    return { ok: false, error: "Cannot delete the default list", status: 409 };
  }
  await prisma.readingList.delete({ where: { id: listId } });
  return { ok: true };
}

/**
 * Adds an article to a list. Idempotent. Both the list ownership and the
 * article's visibility are checked: the article must be viewable by the caller
 * via {@link getReadableArticleById}.
 */
export async function addToList(
  listId: string,
  userId: string,
  articleId: string,
  role?: string | null,
): Promise<SimpleResult> {
  const list = await prisma.readingList.findFirst({ where: { id: listId, userId } });
  if (!list) return { ok: false, error: "List not found", status: 404 };
  const article = await getReadableArticleById(articleId, { role, userId });
  if (!article) return { ok: false, error: "Article not found", status: 404 };
  await prisma.readingListItem.upsert({
    where: { listId_articleId: { listId, articleId } },
    create: { listId, articleId },
    update: {},
  });
  return { ok: true };
}

/**
 * Removes an article from a list. Idempotent. List ownership is checked.
 */
export async function removeFromList(
  listId: string,
  userId: string,
  articleId: string,
): Promise<SimpleResult> {
  const list = await prisma.readingList.findFirst({ where: { id: listId, userId } });
  if (!list) return { ok: false, error: "List not found", status: 404 };
  await prisma.readingListItem.deleteMany({ where: { listId, articleId } });
  return { ok: true };
}

/**
 * Toggles an article in the user's default "Saved" list. Visibility is
 * enforced via {@link getReadableArticleById} so drafts/foreign imports can't
 * be bookmarked or used as an existence oracle.
 */
export async function toggleBookmark(
  userId: string,
  articleId: string,
  role?: string | null,
): Promise<DataResult<{ bookmarked: boolean }>> {
  const article = await getReadableArticleById(articleId, { role, userId });
  if (!article) return { ok: false, error: "Article not found", status: 404 };

  const defaultList = await getOrCreateDefaultList(userId);
  const existing = await prisma.readingListItem.findUnique({
    where: { listId_articleId: { listId: defaultList.id, articleId } },
  });

  if (existing) {
    await prisma.readingListItem.delete({ where: { id: existing.id } });
    return { ok: true, bookmarked: false };
  } else {
    await prisma.readingListItem.create({ data: { listId: defaultList.id, articleId } });
    return { ok: true, bookmarked: true };
  }
}

/**
 * Returns the subset of `articleIds` that the user has bookmarked in any of
 * their reading lists. Call once per page render with all visible article ids.
 */
export async function getBookmarkedArticleIds(
  userId: string,
  articleIds: string[],
): Promise<Set<string>> {
  if (articleIds.length === 0) return new Set();

  const lists = await prisma.readingList.findMany({
    where: { userId },
    select: { id: true },
  });
  if (lists.length === 0) return new Set();

  const listIds = lists.map((l) => l.id);
  const items = await prisma.readingListItem.findMany({
    where: { listId: { in: listIds }, articleId: { in: articleIds } },
    select: { articleId: true },
  });
  return new Set(items.map((i) => i.articleId));
}

export type ListMembership = {
  id: string;
  name: string;
  isDefault: boolean;
  hasArticle: boolean;
};

/**
 * Returns all of the user's lists annotated with whether a given article is in
 * each list. Returns null when the article does not exist or is not viewable.
 */
export async function getArticleListMembership(
  userId: string,
  articleId: string,
  role?: string | null,
): Promise<ListMembership[] | null> {
  const article = await getReadableArticleById(articleId, { role, userId });
  if (!article) return null;

  const lists = await prisma.readingList.findMany({
    where: { userId },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    include: {
      items: {
        where: { articleId },
        select: { id: true },
      },
    },
  });

  return lists.map((l) => ({
    id: l.id,
    name: l.name,
    isDefault: l.isDefault,
    hasArticle: l.items.length > 0,
  }));
}
