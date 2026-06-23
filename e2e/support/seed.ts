import { randomUUID } from "node:crypto";
import type { BrowserContext } from "@playwright/test";
import { ArticleStatus, PrismaClient, type Role } from "@prisma/client";
import { assertSafeE2eDatabaseUrl } from "./db-guard";

export const TEST_ARTICLE_ID = "e2e-critical-reader";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100";
const prisma = new PrismaClient();

const ARTICLE_BODY = `
  <p>ReadWise helps learners read real English news with confidence. This smoke
  article has enough body text to exercise the reader layout, reading progress,
  sanitized HTML rendering, and responsive controls without calling any external
  AI service during the test run.</p>
  <p>The browser checks navigate through dashboard recommendations, category
  browsing, the article reader, and the admin area using a database-backed
  NextAuth session cookie seeded directly into SQLite.</p>
`;

async function resetDatabase(): Promise<void> {
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

export async function seedSmokeData(): Promise<void> {
  await resetDatabase();

  const now = new Date();
  const articles = [
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
  ];

  for (const article of articles) {
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

export async function addSessionCookie(
  context: BrowserContext,
  sessionToken: string,
  expires: Date,
): Promise<void> {
  await context.addCookies([
    {
      name: "next-auth.session-token",
      value: sessionToken,
      url: BASE_URL,
      httpOnly: true,
      sameSite: "Lax",
      expires: Math.floor(expires.getTime() / 1000),
    },
  ]);
}

export async function disconnectDb(): Promise<void> {
  await prisma.$disconnect();
}
