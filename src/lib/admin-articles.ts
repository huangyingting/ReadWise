import { prisma } from "@/lib/prisma";
import type { Article } from "@prisma/client";
import { readingMinutesFor } from "@/lib/articles";

/** Page size for the admin article listing. */
export const ADMIN_ARTICLES_PAGE_SIZE = 20;

export type AdminArticleRow = {
  id: string;
  title: string;
  author: string | null;
  source: string | null;
  category: string | null;
  status: string;
  difficulty: string | null;
  readingMinutes: number | null;
  createdAt: Date;
};

export type AdminArticleSearch = {
  articles: AdminArticleRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  query: string;
  status: string | null;
};

export type SearchArticlesOpts = {
  query?: string;
  status?: string | null;
  page?: number;
  pageSize?: number;
};

/**
 * Searches/filters articles for the admin listing. Matches the query (case
 * insensitively via SQLite LIKE) against title, author and source, and
 * optionally restricts to a single processing `status`. Paginated.
 */
export async function searchArticles(
  opts: SearchArticlesOpts = {},
): Promise<AdminArticleSearch> {
  const query = (opts.query ?? "").trim();
  const status = opts.status && opts.status.trim() ? opts.status.trim() : null;
  const pageSize = opts.pageSize ?? ADMIN_ARTICLES_PAGE_SIZE;
  const page = Math.max(1, opts.page ?? 1);

  const where = {
    ...(status ? { status } : {}),
    ...(query
      ? {
          OR: [
            { title: { contains: query } },
            { author: { contains: query } },
            { source: { contains: query } },
          ],
        }
      : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.article.count({ where }),
    prisma.article.findMany({
      where,
      orderBy: [{ createdAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  const articles: AdminArticleRow[] = rows.map((a) => ({
    id: a.id,
    title: a.title,
    author: a.author,
    source: a.source,
    category: a.category,
    status: a.status,
    difficulty: a.difficulty,
    readingMinutes: readingMinutesFor(a),
    createdAt: a.createdAt,
  }));

  return {
    articles,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    query,
    status,
  };
}

export type AdminArticleAiCounts = {
  translations: number;
  vocabulary: number;
  quizQuestions: number;
  tags: number;
  speech: number;
  readingProgress: number;
};

export type AdminArticleDetail = {
  article: Article;
  counts: AdminArticleAiCounts;
};

/**
 * Loads a single article with the counts of its derived AI content and reader
 * progress for the admin inspection view. Returns `null` for unknown ids.
 */
export async function getAdminArticleDetail(
  id: string,
): Promise<AdminArticleDetail | null> {
  const article = await prisma.article.findUnique({ where: { id } });
  if (!article) {
    return null;
  }

  const [translations, vocabulary, quizQuestions, tags, speech, readingProgress] =
    await Promise.all([
      prisma.translation.count({ where: { articleId: id } }),
      prisma.vocabularyItem.count({ where: { articleId: id } }),
      prisma.quizQuestion.count({ where: { articleId: id } }),
      prisma.articleTag.count({ where: { articleId: id } }),
      prisma.articleSpeech.count({ where: { articleId: id } }),
      prisma.readingProgress.count({ where: { articleId: id } }),
    ]);

  return {
    article,
    counts: { translations, vocabulary, quizQuestions, tags, speech, readingProgress },
  };
}

/**
 * Deletes an article. Related AI content (translations, vocabulary, quiz
 * questions, speech, tag links) and reading progress are removed by the
 * schema's cascade rules. Returns false if the article does not exist.
 */
export async function deleteArticle(id: string): Promise<boolean> {
  const existing = await prisma.article.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!existing) {
    return false;
  }
  await prisma.article.delete({ where: { id } });
  return true;
}

export type RebuildResult = {
  cleared: AdminArticleAiCounts;
};

/**
 * Triggers a rebuild of an article's AI-derived content by clearing the cached
 * translations, vocabulary, quiz questions, speech and tag links. These are
 * regenerated lazily (and gracefully, when AI is configured) the next time a
 * reader opens the article. Reader progress is preserved. Returns null for an
 * unknown article id.
 */
export async function rebuildArticleAi(id: string): Promise<RebuildResult | null> {
  const existing = await prisma.article.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!existing) {
    return null;
  }

  const [translations, vocabulary, quizQuestions, tags, speech] =
    await prisma.$transaction([
      prisma.translation.deleteMany({ where: { articleId: id } }),
      prisma.vocabularyItem.deleteMany({ where: { articleId: id } }),
      prisma.quizQuestion.deleteMany({ where: { articleId: id } }),
      prisma.articleTag.deleteMany({ where: { articleId: id } }),
      prisma.articleSpeech.deleteMany({ where: { articleId: id } }),
    ]);

  return {
    cleared: {
      translations: translations.count,
      vocabulary: vocabulary.count,
      quizQuestions: quizQuestions.count,
      tags: tags.count,
      speech: speech.count,
      readingProgress: 0,
    },
  };
}
