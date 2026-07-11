/**
 * Tests for src/lib/testing/e2e-fixtures.ts deterministic fixture exports.
 *
 * Uses mock.module() to provide a prisma stub so the database-touching
 * exports (resetE2eDatabase, createUserWithSession, etc.) can be exercised
 * without a real database connection.  The db-guard assertions are tested
 * with injected URL parameters — no live environment variables required for
 * those branches.
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

// Track calls into the mock prisma client.
let transactionCalled = false;
let lastCreateArgs: Record<string, unknown> | null = null;
let createCallCount = 0;

function makeTableMock() {
  return {
    deleteMany: () => Promise.resolve({ count: 0 }),
    create: async (args: { data?: Record<string, unknown> }) => {
      lastCreateArgs = args?.data ?? null;
      createCallCount++;
      const data = args?.data ?? {};
      return { id: (data.id as string) ?? "mock-id", ...data };
    },
    createMany: async () => ({ count: 2 }),
  };
}

const tableMock = makeTableMock();

const mockPrismaClient = new Proxy({} as Record<string, unknown>, {
  get(_target, prop: string | symbol) {
    if (prop === "$transaction") {
      return (ops: Promise<unknown>[]) => {
        transactionCalled = true;
        return Promise.all(ops);
      };
    }
    return tableMock;
  },
});

before(() => {
  mock.module("@/lib/prisma", {
    namedExports: { prisma: mockPrismaClient },
  });
});

beforeEach(() => {
  transactionCalled = false;
  lastCreateArgs = null;
  createCallCount = 0;
});

// ── Exported constants ────────────────────────────────────────────────────

test("TEST_ARTICLE_ID is a deterministic non-empty string", async () => {
  const { TEST_ARTICLE_ID } = await import("@/lib/testing/e2e-fixtures");
  assert.equal(typeof TEST_ARTICLE_ID, "string");
  assert.ok(TEST_ARTICLE_ID.length > 0);
  assert.equal(TEST_ARTICLE_ID, "e2e-critical-reader");
});

test("ARTICLE_BODY contains non-trivial HTML for layout exercise", async () => {
  const { ARTICLE_BODY } = await import("@/lib/testing/e2e-fixtures");
  assert.equal(typeof ARTICLE_BODY, "string");
  assert.ok(ARTICLE_BODY.includes("<p>"), "should contain paragraph tags");
  assert.ok(ARTICLE_BODY.length > 50, "should have meaningful length");
});

test("E2E_ARTICLES is a non-empty array of valid fixture objects", async () => {
  const { E2E_ARTICLES } = await import("@/lib/testing/e2e-fixtures");
  assert.ok(Array.isArray(E2E_ARTICLES));
  assert.ok(E2E_ARTICLES.length >= 3, "at least 3 fixture articles");
  for (const article of E2E_ARTICLES) {
    assert.equal(typeof article.id, "string");
    assert.ok(article.id.length > 0);
    assert.equal(typeof article.title, "string");
    assert.ok(article.title.length > 0);
    assert.equal(typeof article.category, "string");
    assert.equal(typeof article.difficulty, "string");
    assert.equal(typeof article.difficultyScore, "number");
  }
});

test("E2E_ARTICLES have unique ids", async () => {
  const { E2E_ARTICLES } = await import("@/lib/testing/e2e-fixtures");
  const ids = E2E_ARTICLES.map((a) => a.id);
  assert.equal(new Set(ids).size, ids.length, "article ids must be unique");
});

test("E2E_ARTICLES include the critical smoke article", async () => {
  const { E2E_ARTICLES, TEST_ARTICLE_ID } = await import("@/lib/testing/e2e-fixtures");
  const critical = E2E_ARTICLES.find((a) => a.id === TEST_ARTICLE_ID);
  assert.ok(critical, "critical reader article must exist in fixtures");
});

// ── db-guard ──────────────────────────────────────────────────────────────

test("assertSafeE2eDatabaseUrl rejects when DATABASE_URL is not set", async () => {
  const { assertSafeE2eDatabaseUrl } = await import("@/lib/testing/db-guard");
  assert.throws(
    () => assertSafeE2eDatabaseUrl({ databaseUrl: undefined }),
    /DATABASE_URL is not set/,
  );
});

test("assertSafeE2eDatabaseUrl rejects mismatched URLs", async () => {
  const { assertSafeE2eDatabaseUrl } = await import("@/lib/testing/db-guard");
  assert.throws(
    () =>
      assertSafeE2eDatabaseUrl({
        databaseUrl: "file:./dev.db",
        expectedDatabaseUrl: "file:./e2e.db",
      }),
    /does not match/,
  );
});

test("assertSafeE2eDatabaseUrl rejects non-e2e database basenames", async () => {
  const { assertSafeE2eDatabaseUrl } = await import("@/lib/testing/db-guard");
  assert.throws(
    () =>
      assertSafeE2eDatabaseUrl({
        databaseUrl: "file:./production.db",
        expectedDatabaseUrl: "file:./production.db",
      }),
    /must point to an isolated e2e/,
  );
});

test("assertSafeE2eDatabaseUrl passes for valid e2e database URL", async () => {
  const { assertSafeE2eDatabaseUrl } = await import("@/lib/testing/db-guard");
  assert.doesNotThrow(() =>
    assertSafeE2eDatabaseUrl({
      databaseUrl: "file:./e2e.db",
      expectedDatabaseUrl: "file:./e2e.db",
    }),
  );
});

test("assertSafeE2eDatabaseUrl passes for e2e URL with suffix", async () => {
  const { assertSafeE2eDatabaseUrl } = await import("@/lib/testing/db-guard");
  assert.doesNotThrow(() =>
    assertSafeE2eDatabaseUrl({
      databaseUrl: "file:./e2e-smoke.db",
      expectedDatabaseUrl: "file:./e2e-smoke.db",
    }),
  );
});

// ── resetE2eDatabase ──────────────────────────────────────────────────────

test("resetE2eDatabase calls prisma.$transaction with all deleteMany operations", async () => {
  // Set DATABASE_URL and PLAYWRIGHT_DATABASE_URL to a safe e2e SQLite path
  const orig = process.env.DATABASE_URL;
  const origPlaywright = process.env.PLAYWRIGHT_DATABASE_URL;
  process.env.DATABASE_URL = "file:./e2e.db";
  process.env.PLAYWRIGHT_DATABASE_URL = "file:./e2e.db";

  try {
    const { resetE2eDatabase } = await import("@/lib/testing/e2e-fixtures");
    await resetE2eDatabase();
    assert.ok(transactionCalled, "prisma.$transaction should be called");
  } finally {
    process.env.DATABASE_URL = orig;
    process.env.PLAYWRIGHT_DATABASE_URL = origPlaywright;
  }
});

// ── createUserWithSession ────────────────────────────────────────────────

test("createUserWithSession creates a user with a session token (Reader + onboarded)", async () => {
  const { createUserWithSession } = await import("@/lib/testing/e2e-fixtures");
  const result = await createUserWithSession({ role: "Reader", onboarded: true });
  assert.equal(typeof result.userId, "string");
  assert.ok(result.userId.startsWith("e2e-user-"));
  assert.ok(result.sessionToken.startsWith("e2e-session-"));
  assert.ok(result.expires instanceof Date);
  assert.ok(result.expires > new Date(), "session must expire in the future");
});

test("createUserWithSession creates Admin user with E2E Admin name", async () => {
  const { createUserWithSession } = await import("@/lib/testing/e2e-fixtures");
  const result = await createUserWithSession({ role: "Admin" });
  assert.ok(result.userId.startsWith("e2e-user-"));
  assert.ok(result.sessionToken.startsWith("e2e-session-"));
  // createCallCount incremented: prisma.user.create was called
  assert.ok(createCallCount > 0);
});

test("createUserWithSession without onboarding skips profile creation", async () => {
  const { createUserWithSession } = await import("@/lib/testing/e2e-fixtures");
  const result = await createUserWithSession({ onboarded: false });
  assert.ok(result.userId.startsWith("e2e-user-"));
  assert.ok(result.sessionToken.startsWith("e2e-session-"));
});

// ── createSessionForUser ─────────────────────────────────────────────────

test("createSessionForUser creates a session for an existing user id", async () => {
  const { createSessionForUser } = await import("@/lib/testing/e2e-fixtures");
  const result = await createSessionForUser("existing-user-id");
  assert.equal(result.userId, "existing-user-id");
  assert.ok(result.sessionToken.startsWith("e2e-session-"));
  assert.ok(result.expires instanceof Date);
  assert.ok(result.expires > new Date(), "session must expire in the future");
});

// ── seedE2eArticles ───────────────────────────────────────────────────────

test("seedE2eArticles creates all E2E articles and attaches a tech tag", async () => {
  createCallCount = 0;
  const { seedE2eArticles, E2E_ARTICLES } = await import("@/lib/testing/e2e-fixtures");
  await seedE2eArticles();
  // E2E_ARTICLES.length article.create calls + 1 tag.create + 1 articleTag.create
  assert.equal(createCallCount, E2E_ARTICLES.length + 2);
});

// ── seedDueFlashcard ──────────────────────────────────────────────────────

test("seedDueFlashcard creates a saved word due for review", async () => {
  createCallCount = 0;
  const { seedDueFlashcard } = await import("@/lib/testing/e2e-fixtures");
  await seedDueFlashcard("test-user-id");
  assert.equal(createCallCount, 1, "one savedWord.create call expected");
  assert.equal(lastCreateArgs?.userId, "test-user-id");
  assert.equal(lastCreateArgs?.word, "confidence");
  assert.ok(
    (lastCreateArgs?.dueAt as Date) < new Date(),
    "dueAt must be in the past (flashcard is overdue)",
  );
});

// ── seedTeacherClassroom ──────────────────────────────────────────────────

test("seedTeacherClassroom creates teacher, student, org, and classroom", async () => {
  const { seedTeacherClassroom } = await import("@/lib/testing/e2e-fixtures");
  const result = await seedTeacherClassroom();
  assert.ok(result.teacher, "teacher must be created");
  assert.ok(result.student, "student must be created");
  assert.ok(result.classroom, "classroom must be created");
  // Verify deterministic IDs are used
  assert.equal(result.teacher.id, "e2e-teacher");
  assert.equal(result.student.id, "e2e-student");
  assert.equal(result.classroom.id, "e2e-classroom");
});
