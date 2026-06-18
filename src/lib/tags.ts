import { prisma } from "@/lib/prisma";
import type { Article } from "@prisma/client";
import { chatComplete, isAiConfigured } from "@/lib/ai";
import { htmlToPlainText } from "@/lib/translation";

export type TagView = {
  id: string;
  name: string;
  slug: string;
};

export type ArticleTagsResult = {
  articleId: string;
  tags: TagView[];
  fallback: boolean;
};

/** Max characters of source text sent to the model (keeps token use bounded). */
const MAX_SOURCE_CHARS = 6000;

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
 * Parses the model's JSON response into a deduped list of tag names, tolerating
 * markdown code fences and surrounding prose. Returns [] when nothing usable.
 */
export function parseTagsJson(raw: string): string[] {
  const fenced = raw.replace(/```(?:json)?/gi, "").trim();
  const start = fenced.indexOf("[");
  const end = fenced.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(fenced.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }

  const seen = new Set<string>();
  const names: string[] = [];
  for (const row of parsed) {
    const name = typeof row === "string" ? row.trim() : "";
    if (!name) {
      continue;
    }
    const slug = slugifyTag(name);
    if (!slug || seen.has(slug)) {
      continue;
    }
    seen.add(slug);
    names.push(name);
  }
  return names;
}

async function generateTags(title: string, content: string): Promise<string[]> {
  const source = htmlToPlainText(content).slice(0, MAX_SOURCE_CHARS);
  const completion = await chatComplete([
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
      content: `Title: ${title}\n\n${source}`,
    },
  ]);

  if (!completion) {
    return [];
  }
  return parseTagsJson(completion).slice(0, TARGET_TAGS);
}

function toView(tag: { id: string; name: string; slug: string }): TagView {
  return { id: tag.id, name: tag.name, slug: tag.slug };
}

/** Reads an article's currently-stored tags, alphabetically by name. */
export async function getArticleTags(articleId: string): Promise<TagView[]> {
  const rows = await prisma.articleTag.findMany({
    where: { articleId },
    orderBy: { tag: { name: "asc" } },
    select: { tag: { select: { id: true, name: true, slug: true } } },
  });
  return rows.map((r) => toView(r.tag));
}

/**
 * Finds-or-creates a Tag by name (slug derived from the name). Tag names are
 * unique case-insensitively via their slug; an existing slug match is reused.
 */
async function upsertTag(name: string): Promise<{ id: string; name: string; slug: string }> {
  const slug = slugifyTag(name);
  const existing = await prisma.tag.findUnique({ where: { slug } });
  if (existing) {
    return existing;
  }
  return prisma.tag.upsert({
    where: { slug },
    update: {},
    create: { name: name.trim(), slug },
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
): Promise<ArticleTagsResult | null> {
  const article = await prisma.article.findUnique({
    where: { id: articleId },
    select: { id: true, title: true, content: true },
  });
  if (!article) {
    return null;
  }

  let tags = await getArticleTags(articleId);
  let fallback = false;

  if (tags.length === 0) {
    if (!isAiConfigured()) {
      fallback = true;
    } else {
      const names = await generateTags(article.title, article.content);
      if (names.length === 0) {
        fallback = true;
      } else {
        for (const name of names) {
          const tag = await upsertTag(name);
          await prisma.articleTag.upsert({
            where: { articleId_tagId: { articleId, tagId: tag.id } },
            update: {},
            create: { articleId, tagId: tag.id },
          });
        }
        tags = await getArticleTags(articleId);
      }
    }
  }

  return { articleId, tags, fallback };
}

/** A tag plus the count of published articles carrying it. */
export type TagWithCount = TagView & { articleCount: number };

/** Looks up a single tag by its slug. */
export async function getTagBySlug(slug: string): Promise<TagView | null> {
  const tag = await prisma.tag.findUnique({
    where: { slug },
    select: { id: true, name: true, slug: true },
  });
  return tag ? toView(tag) : null;
}

/**
 * Returns published articles carrying the given tag slug, newest first.
 * Returns [] when the tag does not exist.
 */
export async function listArticlesByTag(
  slug: string,
  limit = 24,
): Promise<Article[]> {
  return prisma.article.findMany({
    where: { status: "published", tags: { some: { tag: { slug } } } },
    orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
    take: limit,
  });
}

/**
 * Returns published articles related to the given article, ranked by how many
 * tags they share with it (most overlap first, then newest). The source article
 * is excluded and results are de-duplicated and limited. Returns [] when the
 * article has no tags or nothing else shares them.
 */
export async function listRelatedArticles(
  articleId: string,
  limit = 6,
): Promise<Article[]> {
  const ownTags = await prisma.articleTag.findMany({
    where: { articleId },
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
      article: { status: "published" },
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
    where: { id: { in: candidateIds }, status: "published" },
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

/** All tags that have at least one published article, with their counts. */
export async function listTagsWithCounts(): Promise<TagWithCount[]> {
  const tags = await prisma.tag.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      slug: true,
      _count: {
        select: { articles: { where: { article: { status: "published" } } } },
      },
    },
  });
  return tags
    .map((t) => ({ id: t.id, name: t.name, slug: t.slug, articleCount: t._count.articles }))
    .filter((t) => t.articleCount > 0);
}
