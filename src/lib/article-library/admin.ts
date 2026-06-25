/**
 * Admin article commands — search/listing, detail view, delete, and AI rebuild
 * (article-library subsystem, REF-040).
 *
 * All queries go through {@link adminVisibleArticleWhere}; no admin query
 * bypasses operator-only visibility. Mutations record audit events and
 * invalidate derived state as side effects.
 */
import { prisma } from "@/lib/prisma";
import { ArticleStatus, type Article } from "@prisma/client";
import { readingMinutesFor } from "./mapper";
import { recordAuditFromRequest, type AuditRequestInput } from "@/lib/audit";
import {
  getArticleProcessingSteps,
  type StepRow,
} from "@/lib/processing-state";
import {
  SYSTEM_ARTICLE_CONTEXT,
  adminVisibleArticleWhere,
  getAdminVisibleArticleById,
  type ArticleAccessContext,
} from "./policy";

/** Page size for the admin article listing. */
export const ADMIN_ARTICLES_PAGE_SIZE = 20;

export type AdminArticleRow = {
  id: string;
  title: string;
  author: string | null;
  source: string | null;
  category: string | null;
  status: string;
  visibility: string;
  sourceType: string;
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
  context?: ArticleAccessContext | null;
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
  const statusCandidate = opts.status?.trim().toUpperCase();
  const status = statusCandidate &&
    (Object.values(ArticleStatus) as string[]).includes(statusCandidate)
    ? (statusCandidate as ArticleStatus)
    : null;
  const pageSize = opts.pageSize ?? ADMIN_ARTICLES_PAGE_SIZE;
  const page = Math.max(1, opts.page ?? 1);
  const context = opts.context ?? SYSTEM_ARTICLE_CONTEXT;

  const where = adminVisibleArticleWhere(context, {
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
  });

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
    visibility: a.visibility,
    sourceType: a.sourceType,
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

export type DifficultyFeedbackCounts = {
  tooEasy: number;
  justRight: number;
  tooHard: number;
  total: number;
};

export type AdminArticleDetail = {
  article: Article;
  counts: AdminArticleAiCounts;
  difficultyFeedback: DifficultyFeedbackCounts;
  processingSteps: StepRow[];
};

/**
 * Loads a single article with the counts of its derived AI content, reader
 * progress, difficulty feedback distribution, and the durable step-level
 * processing state (RW-016) for the admin inspection view. Returns `null` for
 * unknown ids.
 */
export async function getAdminArticleDetail(
  id: string,
  context: ArticleAccessContext | null = SYSTEM_ARTICLE_CONTEXT,
): Promise<AdminArticleDetail | null> {
  const article = await getAdminVisibleArticleById(id, context);
  if (!article) {
    return null;
  }

  const [
    translations,
    vocabulary,
    quizQuestions,
    tags,
    speech,
    readingProgress,
    feedbackRows,
    processingSteps,
  ] = await Promise.all([
    prisma.translation.count({ where: { articleId: id } }),
    prisma.vocabularyItem.count({ where: { articleId: id } }),
    prisma.quizQuestion.count({ where: { articleId: id } }),
    prisma.articleTag.count({ where: { articleId: id } }),
    prisma.articleSpeech.count({ where: { articleId: id } }),
    prisma.readingProgress.count({ where: { articleId: id } }),
    prisma.articleDifficultyFeedback.findMany({
      where: { articleId: id },
      select: { vote: true },
    }),
    getArticleProcessingSteps(id),
  ]);

  const difficultyFeedback: DifficultyFeedbackCounts = {
    tooEasy: 0,
    justRight: 0,
    tooHard: 0,
    total: feedbackRows.length,
  };
  for (const row of feedbackRows) {
    if (row.vote === "too_easy") difficultyFeedback.tooEasy++;
    else if (row.vote === "just_right") difficultyFeedback.justRight++;
    else if (row.vote === "too_hard") difficultyFeedback.tooHard++;
  }

  return {
    article,
    counts: { translations, vocabulary, quizQuestions, tags, speech, readingProgress },
    difficultyFeedback,
    processingSteps,
  };
}

/**
 * Deletes an article. Related AI content (translations, vocabulary, quiz
 * questions, speech, tag links) and reading progress are removed by the
 * schema's cascade rules. Returns false if the article does not exist.
 */
export async function deleteArticle(
  id: string,
  context: ArticleAccessContext | null = SYSTEM_ARTICLE_CONTEXT,
  audit?: AuditRequestInput,
): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.article.findFirst({
      where: adminVisibleArticleWhere(context, { id }),
      select: { id: true },
    });
    if (!existing) {
      return false;
    }
    await tx.article.delete({ where: { id } });
    if (audit) {
      await recordAuditFromRequest(audit, tx);
    }
    return true;
  });
}

export type RebuildResult = {
  cleared: AdminArticleAiCounts;
};
type RebuildAuditFactory = (result: RebuildResult) => AuditRequestInput;

/**
 * Triggers a rebuild of an article's AI-derived content by clearing the cached
 * translations, vocabulary, quiz questions, speech and tag links. These are
 * regenerated lazily (and gracefully, when AI is configured) the next time a
 * reader opens the article. Reader progress is preserved. Returns null for an
 * unknown article id.
 */
export async function rebuildArticleAi(
  id: string,
  context: ArticleAccessContext | null = SYSTEM_ARTICLE_CONTEXT,
  audit?: RebuildAuditFactory,
): Promise<RebuildResult | null> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.article.findFirst({
      where: adminVisibleArticleWhere(context, { id }),
      select: { id: true },
    });
    if (!existing) {
      return null;
    }

    const [translations, vocabulary, quizQuestions, tags, speech] =
      await Promise.all([
        tx.translation.deleteMany({ where: { articleId: id } }),
        tx.vocabularyItem.deleteMany({ where: { articleId: id } }),
        tx.quizQuestion.deleteMany({ where: { articleId: id } }),
        tx.articleTag.deleteMany({ where: { articleId: id } }),
        tx.articleSpeech.deleteMany({ where: { articleId: id } }),
      ]);

    // Speech audio is being regenerated, so drop any object-storage MediaAsset
    // pointers for this article too (RW-049). The underlying storage objects are
    // content-addressed and overwritten on the next synthesis.
    await tx.mediaAsset.deleteMany({ where: { articleId: id, kind: "speech" } });

    // Reset the durable step state for the cleared features (RW-016) so the
    // admin timeline reflects the post-rebuild reality. Difficulty is NOT
    // cleared by a rebuild, so its step row is preserved.
    await tx.articleProcessingStep.deleteMany({
      where: { articleId: id, step: { not: "difficulty" } },
    });

    const result = {
      cleared: {
        translations: translations.count,
        vocabulary: vocabulary.count,
        quizQuestions: quizQuestions.count,
        tags: tags.count,
        speech: speech.count,
        readingProgress: 0,
      },
    };
    if (audit) {
      await recordAuditFromRequest(audit(result), tx);
    }
    return result;
  });
}
