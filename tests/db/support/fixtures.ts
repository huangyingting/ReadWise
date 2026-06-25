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

export async function seedQueryPlanFixture(): Promise<{ userId: string }> {
  const userId = id("plan_user");
  await prisma.user.create({ data: { id: userId, name: "DB Plan User", role: "Reader" } });

  const now = Date.now();
  const categories = ["science", "technology", "business", "culture"];
  const levels = ["A1", "A2", "B1", "B2", "C1", "C2"];
  const articleRows = Array.from({ length: 720 }, (_, i) => {
    const published = i % 9 !== 0;
    return {
      id: id(`plan_article_${i}`),
      title: published && i % 17 === 0 ? `Nebula planning ${i}` : `Plan article ${i}`,
      author: `Author ${i % 11}`,
      source: `Source ${i % 7}`,
      excerpt: i % 17 === 0 ? "Nebula evidence excerpt" : "Index evidence excerpt",
      content: i % 17 === 0
        ? "Nebula search evidence body with astronomy vocabulary."
        : "Representative index evidence body.",
      category: categories[i % categories.length],
      difficulty: levels[i % levels.length],
      difficultyScore: (i % 100) + 0.5,
      readingMinutes: 4,
      wordCount: 800,
      status: published ? ArticleStatus.PUBLISHED : ArticleStatus.DRAFT,
      visibility: ArticleVisibility.PUBLIC,
      publishedAt: published ? new Date(now - i * 60_000) : null,
      createdAt: new Date(now - i * 120_000),
      updatedAt: new Date(now - i * 60_000),
    };
  });
  await prisma.article.createMany({ data: articleRows });

  await prisma.readingProgress.createMany({
    data: articleRows.slice(0, 500).map((article, i) => ({
      id: id(`plan_progress_${i}`),
      userId,
      articleId: article.id,
      percent: i % 3 === 0 ? 100 : 35,
      completed: i % 3 === 0,
      completedAt: i % 3 === 0 ? new Date(now - i * 90_000) : null,
      createdAt: new Date(now - i * 120_000),
      updatedAt: new Date(now - i * 45_000),
    })),
  });

  await prisma.savedWord.createMany({
    data: Array.from({ length: 420 }, (_, i) => ({
      id: id(`plan_word_${i}`),
      userId,
      word: `planword${i}`,
      explanation: "A representative saved word for query-plan tests.",
      example: "The saved word appears in a deterministic plan fixture.",
      articleId: articleRows[i % articleRows.length].id,
      dueAt: i % 4 === 0 ? null : new Date(now - i * 30_000),
      createdAt: new Date(now - i * 60_000),
      updatedAt: new Date(now - i * 30_000),
    })),
  });

  await Promise.all([
    prisma.$executeRawUnsafe('ANALYZE "Article"'),
    prisma.$executeRawUnsafe('ANALYZE "ReadingProgress"'),
    prisma.$executeRawUnsafe('ANALYZE "SavedWord"'),
  ]);

  return { userId };
}
