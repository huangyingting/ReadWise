/**
 * Common fixture builders for PostgreSQL query-plan integration tests.
 *
 * Seeds a representative dataset (articles, reading progress, saved words)
 * large enough to make PostgreSQL choose indexed paths when seqscan is
 * disabled.  All rows are created under the integration-test PREFIX so the
 * afterEach cleanup sweep removes them automatically.
 */

import { ArticleStatus, ArticleVisibility } from "@prisma/client";

import { prisma } from "@/lib/prisma";

import { id } from "./db-helpers";

const ARTICLE_COUNT = 720;
const PROGRESS_COUNT = 500;
const SAVED_WORD_COUNT = 420;
const NEBULA_INTERVAL = 17;
const DRAFT_INTERVAL = 9;

const CATEGORIES = ["science", "technology", "business", "culture"] as const;
const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;

const MINUTE_MS = 60_000;

function buildArticleRows(now: number) {
  return Array.from({ length: ARTICLE_COUNT }, (_, i) => {
    const published = i % DRAFT_INTERVAL !== 0;
    const hasNebulaTerms = i % NEBULA_INTERVAL === 0;

    return {
      id: id(`plan_article_${i}`),
      title: published && hasNebulaTerms ? `Nebula planning ${i}` : `Plan article ${i}`,
      author: `Author ${i % 11}`,
      source: `Source ${i % 7}`,
      excerpt: hasNebulaTerms ? "Nebula evidence excerpt" : "Index evidence excerpt",
      content: hasNebulaTerms
        ? "Nebula search evidence body with astronomy vocabulary."
        : "Representative index evidence body.",
      category: CATEGORIES[i % CATEGORIES.length],
      difficulty: LEVELS[i % LEVELS.length],
      difficultyScore: (i % 100) + 0.5,
      readingMinutes: 4,
      wordCount: 800,
      status: published ? ArticleStatus.PUBLISHED : ArticleStatus.DRAFT,
      visibility: ArticleVisibility.PUBLIC,
      publishedAt: published ? new Date(now - i * MINUTE_MS) : null,
      createdAt: new Date(now - i * 2 * MINUTE_MS),
      updatedAt: new Date(now - i * MINUTE_MS),
    };
  });
}

function buildReadingProgressRows(
  articles: Array<{ id: string }>,
  userId: string,
  now: number,
) {
  return articles.slice(0, PROGRESS_COUNT).map((article, i) => {
    const completed = i % 3 === 0;

    return {
      id: id(`plan_progress_${i}`),
      userId,
      articleId: article.id,
      percent: completed ? 100 : 35,
      completed,
      completedAt: completed ? new Date(now - i * 90_000) : null,
      createdAt: new Date(now - i * 2 * MINUTE_MS),
      updatedAt: new Date(now - i * 45_000),
    };
  });
}

function buildSavedWordRows(articles: Array<{ id: string }>, userId: string, now: number) {
  return Array.from({ length: SAVED_WORD_COUNT }, (_, i) => ({
    id: id(`plan_word_${i}`),
    userId,
    word: `planword${i}`,
    explanation: "A representative saved word for query-plan tests.",
    example: "The saved word appears in a deterministic plan fixture.",
    articleId: articles[i % articles.length].id,
    dueAt: i % 4 === 0 ? null : new Date(now - i * 30_000),
    createdAt: new Date(now - i * MINUTE_MS),
    updatedAt: new Date(now - i * 30_000),
  }));
}

export async function seedQueryPlanFixture(): Promise<{ userId: string }> {
  const userId = id("plan_user");
  await prisma.user.create({ data: { id: userId, name: "DB Plan User", role: "Reader" } });

  const now = Date.now();
  const articleRows = buildArticleRows(now);
  await prisma.article.createMany({ data: articleRows });

  await prisma.readingProgress.createMany({
    data: buildReadingProgressRows(articleRows, userId, now),
  });

  await prisma.savedWord.createMany({
    data: buildSavedWordRows(articleRows, userId, now),
  });

  await Promise.all([
    prisma.$executeRawUnsafe('ANALYZE "Article"'),
    prisma.$executeRawUnsafe('ANALYZE "ReadingProgress"'),
    prisma.$executeRawUnsafe('ANALYZE "SavedWord"'),
  ]);

  return { userId };
}
