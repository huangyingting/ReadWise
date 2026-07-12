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
import {
  ArticleStatus,
  type Classroom,
  type Role,
  type User,
} from "@prisma/client";

import { prisma } from "@/lib/prisma";

import { assertSafeE2eDatabaseUrl } from "./db-guard";

export const TEST_ARTICLE_ID = "e2e-critical-reader";
export const TEST_MEMBER_ID = "e2e-reader-member";
const FIXED_ARTICLE_PUBLISHED_AT = new Date("2026-01-15T12:00:00.000Z");

export const ARTICLE_BODY = `
  <p>ReadWise helps learners read real English news with confidence. This smoke
  article has enough body text to exercise the reader layout, reading progress,
  sanitized HTML rendering, and responsive controls without calling any external
  AI service during the test run.</p>
  <p>The browser checks navigate through dashboard recommendations, category
  browsing, the article reader, and the admin area using a database-backed
  NextAuth session cookie seeded directly into SQLite.</p>
`;

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const E2E_PROFILE_TOPICS = ["tech", "world"] as const;
const E2E_TECH_TAG = { id: "e2e-tag-tech", name: "Technology", slug: "tech" } as const;

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

type E2eArticleFixture = (typeof E2E_ARTICLES)[number];

function nameForRole(role: Role): string {
  return role === "Admin" ? "E2E Admin" : "E2E Reader";
}

function onboardedProfileCreateData() {
  return {
    profile: {
      create: {
        englishLevel: "B1",
        topics: [...E2E_PROFILE_TOPICS],
        completedAt: new Date(),
      },
    },
  };
}

function articleCreateData(article: E2eArticleFixture, publishedAt: Date) {
  return {
    ...article,
    author: "ReadWise QA",
    source: "E2E News",
    sourceUrl: `https://example.com/${article.id}`,
    excerpt: "A reliable local article fixture for Playwright smoke tests.",
    content: ARTICLE_BODY,
    wordCount: 92,
    readingMinutes: 1,
    status: ArticleStatus.PUBLISHED,
    publishedAt,
  };
}

/**
 * Resets the E2E database, deleting all rows in foreign-key dependency order.
 *
 * Guarded: refuses to run unless DATABASE_URL is an isolated e2e*.db SQLite
 * file matching the Playwright E2E database URL (via `assertSafeE2eDatabaseUrl`).
 */
export async function resetE2eDatabase(): Promise<void> {
  assertSafeE2eDatabaseUrl();

  await prisma.$transaction([
    prisma.todayComprehensionFeedback.deleteMany(),
    prisma.todaySession.deleteMany(),
    prisma.assignmentCompletion.deleteMany(),
    prisma.assignment.deleteMany(),
    prisma.classroomMembership.deleteMany(),
    prisma.classroom.deleteMany(),
    prisma.membership.deleteMany(),
    prisma.organization.deleteMany(),
    prisma.contentReport.deleteMany(),
    prisma.contentReview.deleteMany(),
    prisma.mediaAsset.deleteMany(),
    prisma.articleProcessingStep.deleteMany(),
    prisma.analyticsEvent.deleteMany(),
    prisma.reminderPreference.deleteMany(),
    prisma.placementResult.deleteMany(),
    prisma.seriesEnrollment.deleteMany(),
    prisma.readingSeries.deleteMany(),
    prisma.skillMastery.deleteMany(),
    prisma.articleMastery.deleteMany(),
    prisma.wordMastery.deleteMany(),
    prisma.learnerCoachMemory.deleteMany(),
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
  const expires = new Date(Date.now() + SESSION_TTL_MS);

  await prisma.user.create({
    data: {
      id: userId,
      name: nameForRole(role),
      email: `${userId}@example.com`,
      role,
      sessions: {
        create: {
          sessionToken,
          expires,
        },
      },
      ...(onboarded ? onboardedProfileCreateData() : {}),
    },
  });

  return { userId, sessionToken, expires };
}

export async function createSessionForUser(
  userId: string,
): Promise<{ userId: string; sessionToken: string; expires: Date }> {
  const sessionToken = `e2e-session-${randomUUID()}`;
  const expires = new Date(Date.now() + SESSION_TTL_MS);

  await prisma.session.create({
    data: {
      userId,
      sessionToken,
      expires,
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
  for (const article of E2E_ARTICLES) {
    await prisma.article.create({
      data: articleCreateData(article, FIXED_ARTICLE_PUBLISHED_AT),
    });
  }

  const tag = await prisma.tag.create({
    data: E2E_TECH_TAG,
  });
  await prisma.articleTag.create({
    data: { articleId: TEST_ARTICLE_ID, tagId: tag.id },
  });
}

/**
 * Seeds a deterministic Reader member used by the admin member-detail UI audit.
 * Uses a fixed ID so the route profile can reference it statically.
 */
export async function seedE2eMember(): Promise<void> {
  await prisma.user.create({
    data: {
      id: TEST_MEMBER_ID,
      name: "E2E Reader Member",
      email: "e2e-reader-member@example.com",
      role: "Reader",
      ...onboardedProfileCreateData(),
    },
  });
}

export async function seedDueFlashcard(userId: string): Promise<void> {
  await prisma.savedWord.create({
    data: {
      userId,
      word: "confidence",
      explanation: "A feeling that you can do something well.",
      example: "Learners read with more confidence after regular practice.",
      contextSentence: "ReadWise helps learners read real English news with confidence.",
      articleId: TEST_ARTICLE_ID,
      dueAt: new Date("2026-01-01T00:00:00.000Z"),
    },
  });
}

export async function seedTeacherClassroom(): Promise<{
  teacher: User;
  student: User;
  classroom: Classroom;
}> {
  const teacher = await prisma.user.create({
    data: {
      id: "e2e-teacher",
      name: "E2E Teacher",
      email: "e2e-teacher@example.com",
      role: "Reader",
      profile: { create: onboardedProfileCreateData().profile.create },
    },
  });
  const student = await prisma.user.create({
    data: {
      id: "e2e-student",
      name: "E2E Student",
      email: "e2e-student@example.com",
      role: "Reader",
      profile: { create: onboardedProfileCreateData().profile.create },
    },
  });
  const org = await prisma.organization.create({
    data: {
      id: "e2e-org",
      name: "E2E Learning Org",
      slug: "e2e-learning-org",
    },
  });
  await prisma.membership.create({
    data: { userId: teacher.id, orgId: org.id, role: "OrgAdmin" },
  });
  await prisma.membership.create({
    data: { userId: student.id, orgId: org.id, role: "Student" },
  });
  const classroom = await prisma.classroom.create({
    data: {
      id: "e2e-classroom",
      orgId: org.id,
      name: "E2E Reading Group",
      teacherId: teacher.id,
    },
  });
  await prisma.classroomMembership.createMany({
    data: [
      { classroomId: classroom.id, userId: teacher.id, role: "Teacher" },
      { classroomId: classroom.id, userId: student.id, role: "Student" },
    ],
  });

  return { teacher, student, classroom };
}
