/**
 * Unit tests for printable classroom packets (#1306): reader/print-modes.ts
 * and reader/print.ts.
 *
 * Covers mode parsing, option letters, answer-key RBAC (teachers via tenant
 * membership, content staff and super-users via global role, everyone else
 * refused), and the printable-article loader: unreadable → null, takedown →
 * restricted, article-only skips study material, worksheet loads stored quiz
 * and vocabulary only, rights note and canonical-URL citation.
 */
process.env.LOG_LEVEL = "error";

import { before, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { optionLetter, parsePrintMode, PRINT_MODE_LABELS, PRINT_MODES } from "@/lib/reader/print-modes";

type StubArticle = {
  id: string;
  title: string;
  author: string | null;
  source: string | null;
  content: string;
  publishedAt: Date | null;
  canonicalUrl: string | null;
  sourceUrl: string | null;
  takedownState: string;
  rightsNote: string | null;
};

function article(overrides: Partial<StubArticle> = {}): StubArticle {
  return {
    id: "a1",
    title: "Octopus minds",
    author: "Jane Smith",
    source: "BBC Future",
    content: "<p>First.</p><p>Second.</p><script>alert(1)</script>",
    publishedAt: new Date("2024-05-03T08:00:00Z"),
    canonicalUrl: "https://canonical.example/a1",
    sourceUrl: "https://scraped.example/a1",
    takedownState: "active",
    rightsNote: null,
    ...overrides,
  };
}

let teachingMembership: { id: string } | null = null;
let membershipQueries: Array<Record<string, unknown>> = [];
let readable: StubArticle | null = article();
let accessUsers: unknown[] = [];
let storedQuiz: Array<{ question: string; options: string[]; correctIndex: number }> | null = null;
let storedVocabulary: Array<{ word: string; explanation: string; example: string }> | null = null;
let studyReads: string[] = [];

before(() => {
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        membership: {
          findFirst: async (args: Record<string, unknown>) => {
            membershipQueries.push(args);
            return teachingMembership;
          },
        },
      },
    },
  });
  mock.module("@/lib/article-library", {
    namedExports: {
      articleAccessContextForUser: async (user: unknown) => {
        accessUsers.push(user);
        return { userId: "u1" };
      },
      getReadableArticleById: async (id: string) => (readable && readable.id === id ? readable : null),
    },
  });
  mock.module("@/lib/quiz", {
    namedExports: {
      readCachedQuiz: async (id: string) => {
        studyReads.push(`quiz:${id}`);
        return storedQuiz;
      },
    },
  });
  mock.module("@/lib/vocabulary/service", {
    namedExports: {
      readCachedVocabulary: async (id: string) => {
        studyReads.push(`vocabulary:${id}`);
        return storedVocabulary;
      },
    },
  });
});

beforeEach(() => {
  teachingMembership = null;
  membershipQueries = [];
  readable = article();
  accessUsers = [];
  storedQuiz = null;
  storedVocabulary = null;
  studyReads = [];
});

async function load() {
  return import("@/lib/reader/print");
}

const READER = { id: "u1", role: "Reader" };

// ---- modes -----------------------------------------------------------------

test("parsePrintMode accepts known modes and defaults everything else to article", () => {
  for (const mode of PRINT_MODES) assert.equal(parsePrintMode(mode), mode);
  assert.equal(parsePrintMode(["worksheet", "answer-key"]), "worksheet");
  for (const value of [undefined, "", "ANSWER-KEY", "teacher", []]) {
    assert.equal(parsePrintMode(value as string | string[] | undefined), "article");
  }
  assert.deepEqual(Object.keys(PRINT_MODE_LABELS), [...PRINT_MODES]);
});

test("optionLetter maps option indexes to A, B, C…", () => {
  assert.deepEqual([0, 1, 2, 3].map(optionLetter), ["A", "B", "C", "D"]);
});

// ---- answer-key RBAC -------------------------------------------------------

test("teachers and org admins (classroom.manage memberships) may print answer keys", async () => {
  const { canPrintAnswerKey } = await load();
  teachingMembership = { id: "m1" };
  assert.equal(await canPrintAnswerKey(READER), true);
  const where = membershipQueries[0]?.where as { userId: string; role: { in: string[] } };
  assert.equal(where.userId, "u1");
  assert.deepEqual([...where.role.in].sort(), ["OrgAdmin", "Teacher"]);
});

test("plain readers, students, and members are refused the answer key", async () => {
  const { canPrintAnswerKey } = await load();
  assert.equal(await canPrintAnswerKey(READER), false);
  assert.equal(await canPrintAnswerKey({ id: "u2", role: null }), false);
  assert.equal(await canPrintAnswerKey({ id: "u3", role: "SupportAgent" }), false);
  assert.equal(membershipQueries.length, 3);
});

test("content staff and platform super-users may print answer keys without a membership", async () => {
  const { canPrintAnswerKey } = await load();
  for (const role of ["Admin", "ContentEditor", "Moderator"]) {
    assert.equal(await canPrintAnswerKey({ id: "staff", role }), true, role);
  }
  assert.equal(membershipQueries.length, 0);
});

// ---- loader ----------------------------------------------------------------

test("unreadable articles load as null", async () => {
  const { loadPrintableArticle } = await load();
  readable = null;
  assert.equal(await loadPrintableArticle("a1", READER, "article"), null);
  assert.deepEqual(accessUsers, [READER]);
});

test("non-active takedown states are restricted and never expose content", async () => {
  const { loadPrintableArticle } = await load();
  for (const takedownState of ["takedown", "unpublished", "archived"]) {
    readable = article({ takedownState });
    assert.deepEqual(await loadPrintableArticle("a1", READER, "worksheet"), {
      restricted: true,
      article: { id: "a1", title: "Octopus minds" },
    });
  }
  assert.deepEqual(studyReads, []);
});

test("article-only packets sanitize the body, cite the canonical URL, and skip study material", async () => {
  const { loadPrintableArticle } = await load();
  readable = article({ rightsNote: "  CC BY 4.0  " });
  const printable = await loadPrintableArticle("a1", READER, "article", {
    accessedAt: new Date("2026-11-17T00:00:00Z"),
  });
  assert.ok(printable && !printable.restricted);
  assert.deepEqual(printable.article, { id: "a1", title: "Octopus minds", author: "Jane Smith", source: "BBC Future" });
  assert.match(printable.bodyHtml, /<p>First\.<\/p>/);
  assert.equal(printable.bodyHtml.includes("<script"), false);
  assert.equal(printable.rightsNote, "CC BY 4.0");
  assert.equal(printable.citation.style, "mla");
  assert.match(printable.citation.text, /canonical\.example\/a1\.$/);
  assert.deepEqual(printable.quiz, []);
  assert.deepEqual(printable.vocabulary, []);
  assert.deepEqual(studyReads, []);
});

test("worksheet and answer-key packets load stored quiz and vocabulary only", async () => {
  const { loadPrintableArticle } = await load();
  storedQuiz = [{ question: "Q1?", options: ["a", "b"], correctIndex: 1 }];
  storedVocabulary = [{ word: "cephalopod", explanation: "a sea animal", example: "An octopus is a cephalopod." }];
  for (const mode of ["worksheet", "answer-key"] as const) {
    studyReads = [];
    const printable = await loadPrintableArticle("a1", READER, mode);
    assert.ok(printable && !printable.restricted);
    assert.deepEqual(printable.quiz, storedQuiz);
    assert.deepEqual(printable.vocabulary, storedVocabulary);
    assert.deepEqual(studyReads.sort(), ["quiz:a1", "vocabulary:a1"]);
  }
});

test("missing stored study material yields empty sections and blank rights notes are dropped", async () => {
  const { loadPrintableArticle } = await load();
  readable = article({ rightsNote: "   ", canonicalUrl: null });
  const printable = await loadPrintableArticle("a1", READER, "worksheet");
  assert.ok(printable && !printable.restricted);
  assert.deepEqual(printable.quiz, []);
  assert.deepEqual(printable.vocabulary, []);
  assert.equal(printable.rightsNote, null);
  assert.match(printable.citation.text, /scraped\.example\/a1/);
});
