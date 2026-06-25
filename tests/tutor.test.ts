/**
 * Tests for src/lib/tutor.ts — the M12 AI tutor data layer.
 * Mocks @/lib/prisma, @/lib/ai, and profile-preferences repository.
 * No DB / network is touched.
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

// --- mutable state read by module mocks ---
let aiConfigured = false;
let aiReply: string | null = null;
let lastChatMessages: Array<{ role: string; content: string }> = [];
let lastChatOptions: { maxOutputTokens?: number; feature?: string } = {};

type Article = { title: string; content: string } | null;
let mockArticle: Article = null;

type MessageRow = { id: string; role: string; content: string; createdAt: Date };
let messageRows: MessageRow[] = [];
let createCalls: { role: string; content: string }[] = [];
let deleteManyCount = 0;

type ProfileRow = { englishLevel: string } | null;
let mockProfile: ProfileRow = null;

before(() => {
  mock.module("@/lib/ai", {
    namedExports: {
      isAiConfigured: () => aiConfigured,
      aiModelName: () => (aiConfigured ? "gpt-test" : null),
      chatComplete: async (
        msgs: Array<{ role: string; content: string }>,
        opts: { maxOutputTokens?: number; feature?: string } = {},
      ) => {
        lastChatMessages = msgs;
        lastChatOptions = opts;
        return aiReply;
      },
    },
  });

  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        article: {
          findUnique: async () => mockArticle,
        },
        tutorMessage: {
          findMany: async (args: {
            where: { userId: string; articleId: string };
            orderBy?: { createdAt: "asc" | "desc" };
            take?: number;
            select?: unknown;
          }) => {
            let rows = [...messageRows];
            if (args.orderBy?.createdAt === "desc") {
              rows = rows.reverse();
            }
            if (args.take !== undefined) {
              rows = rows.slice(0, args.take);
            }
            // If fetching desc then caller reverses — keep the mutable array intact
            return rows;
          },
          create: async (args: { data: { role: string; content: string } }) => {
            const row: MessageRow = {
              id: `msg-${createCalls.length + 1}`,
              role: args.data.role,
              content: args.data.content,
              createdAt: new Date(),
            };
            createCalls.push({ role: args.data.role, content: args.data.content });
            messageRows.push(row);
            return row;
          },
          deleteMany: async () => {
            deleteManyCount++;
            messageRows = [];
            return { count: 0 };
          },
        },
        $transaction: async (ops: Promise<unknown>[]) => {
          return Promise.all(ops);
        },
        profile: {
          findUnique: async () => mockProfile,
        },
      },
    },
  });

  // getProfile calls prisma.profile.findUnique — stub the repository so the
  // import chain resolves without touching the real DB.
  mock.module("@/features/profile-preferences/repository", {
    namedExports: {
      getProfile: async () => mockProfile,
      isOnboarded: (p: ProfileRow | null) => Boolean(p),
    },
  });
});

beforeEach(() => {
  aiConfigured = false;
  aiReply = null;
  lastChatMessages = [];
  lastChatOptions = {};
  mockArticle = { title: "Test Article", content: "<p>This is the article body.</p>" };
  messageRows = [];
  createCalls = [];
  deleteManyCount = 0;
  mockProfile = { englishLevel: "B1" };
});

// ---- getTutorMessages ---------------------------------------------------

test("getTutorMessages returns messages ordered by createdAt asc", async () => {
  messageRows = [
    { id: "1", role: "user", content: "Hello?", createdAt: new Date("2026-01-01") },
    { id: "2", role: "assistant", content: "Hi!", createdAt: new Date("2026-01-02") },
  ];
  const { getTutorMessages } = await import("@/lib/tutor");
  const msgs = await getTutorMessages("user-1", "article-1");
  assert.equal(msgs.length, 2);
  assert.equal(msgs[0].role, "user");
  assert.equal(msgs[1].role, "assistant");
});

test("getTutorMessages returns empty array when no conversation exists", async () => {
  const { getTutorMessages } = await import("@/lib/tutor");
  const msgs = await getTutorMessages("user-1", "no-article");
  assert.equal(msgs.length, 0);
});

// ---- askTutor — article not found --------------------------------------

test("askTutor returns null for a missing article", async () => {
  mockArticle = null;
  const { askTutor } = await import("@/lib/tutor");
  const result = await askTutor("user-1", "missing", "What is this about?");
  assert.equal(result, null);
  assert.equal(createCalls.length, 0);
});

// ---- askTutor — AI unconfigured ----------------------------------------

test("askTutor returns fallback:true and persists nothing when AI is unconfigured", async () => {
  aiConfigured = false;
  const { askTutor } = await import("@/lib/tutor");
  const result = await askTutor("user-1", "article-1", "What is this about?");
  assert.ok(result !== null);
  assert.equal(result.fallback, true);
  assert.match(result.answer, /unavailable/i);
  assert.equal(createCalls.length, 0, "no messages should be persisted on fallback");
});

// ---- askTutor — AI configured but chatComplete returns null -------------

test("askTutor returns fallback:true and persists nothing when chatComplete fails", async () => {
  aiConfigured = true;
  aiReply = null;
  const { askTutor } = await import("@/lib/tutor");
  const result = await askTutor("user-1", "article-1", "What is this about?");
  assert.ok(result !== null);
  assert.equal(result.fallback, true);
  assert.equal(createCalls.length, 0, "no messages should be persisted on AI failure");
});

// ---- askTutor — happy path ---------------------------------------------

test("askTutor AI-configured happy path: persists user + assistant messages, returns answer", async () => {
  aiConfigured = true;
  aiReply = "The article is about testing.";
  const { askTutor } = await import("@/lib/tutor");
  const result = await askTutor("user-1", "article-1", "What is this about?");
  assert.ok(result !== null);
  assert.equal(result.fallback, false);
  assert.equal(result.answer, "The article is about testing.");
  assert.equal(createCalls.length, 2, "should persist exactly 2 messages");
  assert.equal(createCalls[0].role, "user");
  assert.equal(createCalls[0].content, "What is this about?");
  assert.equal(createCalls[1].role, "assistant");
  assert.equal(createCalls[1].content, "The article is about testing.");
});

test("askTutor returns the updated messages list after a successful exchange", async () => {
  aiConfigured = true;
  aiReply = "The article is about testing.";
  const { askTutor } = await import("@/lib/tutor");
  const result = await askTutor("user-1", "article-1", "What is this about?");
  assert.ok(result !== null);
  // After persist, messageRows has 2 entries; getTutorMessages returns them.
  assert.equal(result.messages.length, 2);
  assert.equal(result.messages[0].role, "user");
  assert.equal(result.messages[1].role, "assistant");
});

test("askTutor uses the user's englishLevel in the system prompt", async () => {
  aiConfigured = true;
  aiReply = "A2 answer";
  mockProfile = { englishLevel: "A2" };

  const { askTutor } = await import("@/lib/tutor");
  await askTutor("user-1", "article-1", "Simple question?");

  const systemMsg = lastChatMessages.find((m) => m.role === "system");
  assert.ok(systemMsg?.content.includes("A2"), "system prompt should mention the CEFR level A2");
});

test("askTutor falls back to B1 when user has no profile", async () => {
  aiConfigured = true;
  aiReply = "B1 answer";
  mockProfile = null;

  const { askTutor } = await import("@/lib/tutor");
  await askTutor("user-1", "article-1", "What level?");

  const systemMsg = lastChatMessages.find((m) => m.role === "system");
  assert.ok(systemMsg?.content.includes("B1"), "should default to B1 when no profile");
});

// ---- clearTutor --------------------------------------------------------

test("clearTutor deletes all messages for the user+article", async () => {
  messageRows = [
    { id: "1", role: "user", content: "Q", createdAt: new Date() },
    { id: "2", role: "assistant", content: "A", createdAt: new Date() },
  ];
  const { clearTutor } = await import("@/lib/tutor");
  await clearTutor("user-1", "article-1");
  assert.equal(deleteManyCount, 1);
  assert.equal(messageRows.length, 0);
});

// ---- askTutor — token budget (#105) ------------------------------------

test("askTutor uses a token budget of at least 1500 (fixes gpt-5-mini reasoning budget)", async () => {
  aiConfigured = true;
  aiReply = "Answer about the article.";
  const { askTutor } = await import("@/lib/tutor");
  await askTutor("user-1", "article-1", "What is this about?");
  assert.ok(
    (lastChatOptions.maxOutputTokens ?? 0) >= 1500,
    `maxOutputTokens should be >= 1500 to avoid exhausting reasoning budget, got ${lastChatOptions.maxOutputTokens}`,
  );
});

test("askTutor passes feature='tutor' to chatComplete for diagnostic logging", async () => {
  aiConfigured = true;
  aiReply = "Some answer.";
  const { askTutor } = await import("@/lib/tutor");
  await askTutor("user-1", "article-1", "Hello?");
  assert.equal(lastChatOptions.feature, "tutor");
});
