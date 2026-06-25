/**
 * Deterministic fixture builders for E2E smoke tests and unit tests.
 *
 * Provides:
 * - Static article/tag fixture definitions used across Playwright smoke tests.
 * - `resetE2eDatabase` — safe, ordered full-database reset (guarded against
 *   non-test databases via `assertSafeE2eDatabaseUrl`).
 * - `createUserWithSession` — creates a representative user + NextAuth session
 *   row suitable for cookie-seeded E2E and unit test scenarios.
 *
 * Keep production-like scraper seed in `src/lib/seed.ts` (separate concern).
 */

import { randomUUID } from "node:crypto";
import { ArticleStatus, type Role } from "@prisma/client";

import { prisma } from "@/lib/prisma";

import { assertSafeE2eDatabaseUrl } from "./db-guard";

export const TEST_ARTICLE_ID = "e2e-critical-reader";

export const ARTICLE_BODY = `
  <p>ReadWise helps learners read real English news with confidence. This smoke
  article has enough body text to exercise the reader layout, reading progress,
  sanitized HTML rendering, and responsive controls without calling any external
  AI service during the test run.</p>
  <p>The browser checks navigate through dashboard recommendations, category
  browsing, the article reader, and the admin area using a database-backed
  NextAuth session cookie seeded directly into SQLite.</p>
`;

/** Deterministic article fixtures used by the E2E smoke suite. */
export const E2E_ARTICLES = [
  {
    id: TEST_ARTICLE_ID,
    title: "E2E Critical Reading Smoke Article",
    category: "tech",
    difficulty: "B1",
    difficultyScore: 42,
  },
  {
    id: "e2e-browse-world",
    title: "E2E World News Practice",
    category: "world",
    difficulty: "A2",
    difficultyScore: 30,
  },
  {
    id: "e2e-browse-science",
    title: "E2E Science Discovery Practice",
    category: "science",
    difficulty: "B1",
    difficultyScore: 45,
  },
] as const;

/**
 * Resets the E2E database, deleting all rows in foreign-key dependency order.
 *
 * Guarded: refuses to run unless DATABASE_URL is an isolated e2e*.db SQLite
 * file matching the Playwright E2E database URL (via `assertSafeE2eDatabaseUrl`).
 */
export async function resetE2eDatabase(): Promise<void> {
  assertSafeE2eDatabaseUrl();

  await prisma.$transaction([
    prisma.articleDifficultyFeedback.deleteMany(),
    prisma.grammarExplanation.deleteMany(),
    prisma.pronunciationAttempt.deleteMany(),
    prisma.quizAttempt.deleteMany(),
    prisma.sentenceTranslation.deleteMany(),
    prisma.highlight.deleteMany(),
    prisma.tutorMessage.deleteMany(),
    prisma.readingListItem.deleteMany(),
    prisma.readingList.deleteMany(),
    prisma.pushSubscription.deleteMany(),
    prisma.levelHistory.deleteMany(),
    prisma.dailyActivity.deleteMany(),
    prisma.savedWord.deleteMany(),
    prisma.readingProgress.deleteMany(),
    prisma.translation.deleteMany(),
    prisma.quizQuestion.deleteMany(),
    prisma.vocabularyItem.deleteMany(),
    prisma.articleSpeech.deleteMany(),
    prisma.articleTag.deleteMany(),
    prisma.tag.deleteMany(),
    prisma.article.deleteMany(),
    prisma.profile.deleteMany(),
    prisma.account.deleteMany(),
    prisma.session.deleteMany(),
    prisma.verificationToken.deleteMany(),
    prisma.user.deleteMany(),
  ]);
}

/**
 * Creates a deterministic user with a NextAuth session row.
 *
 * Returns the `userId`, `sessionToken`, and session `expires` date so the
 * caller can inject the session cookie without an HTTP round-trip.
 */
export async function createUserWithSession({
  role = "Reader",
  onboarded = true,
}: {
  role?: Role;
  onboarded?: boolean;
} = {}): Promise<{ userId: string; sessionToken: string; expires: Date }> {
  const userId = `e2e-user-${randomUUID()}`;
  const sessionToken = `e2e-session-${randomUUID()}`;
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);

  await prisma.user.create({
    data: {
      id: userId,
      name: role === "Admin" ? "E2E Admin" : "E2E Reader",
      email: `${userId}@example.com`,
      role,
      sessions: {
        create: {
          sessionToken,
          expires,
        },
      },
      ...(onboarded
        ? {
            profile: {
              create: {
                englishLevel: "B1",
                topics: ["tech", "world"],
                completedAt: new Date(),
              },
            },
          }
        : {}),
    },
  });

  return { userId, sessionToken, expires };
}

/**
 * Seeds the deterministic E2E article fixtures (smoke articles + tech tag)
 * into an already-reset database.
 *
 * Extracted here so both the Playwright seed helper and any future
 * integration tests can reuse the same fixture set without copy-pasting.
 */
export async function seedE2eArticles(): Promise<void> {
  const now = new Date();

  for (const article of E2E_ARTICLES) {
    await prisma.article.create({
      data: {
        ...article,
        author: "ReadWise QA",
        source: "E2E News",
        sourceUrl: `https://example.com/${article.id}`,
        excerpt: "A reliable local article fixture for Playwright smoke tests.",
        content: ARTICLE_BODY,
        wordCount: 92,
        readingMinutes: 1,
        status: ArticleStatus.PUBLISHED,
        publishedAt: now,
      },
    });
  }

  const tag = await prisma.tag.create({
    data: { id: "e2e-tag-tech", name: "Technology", slug: "tech" },
  });
  await prisma.articleTag.create({
    data: { articleId: TEST_ARTICLE_ID, tagId: tag.id },
  });
}
