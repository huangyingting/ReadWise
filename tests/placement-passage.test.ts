/**
 * Tests for src/lib/learning/placement-passage.ts — placement passage
 * selection logic. Covers candidate scanning, question validation,
 * graceful null fallback, and constants.
 */
import { test, describe, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Prisma / dependency mocks
// ---------------------------------------------------------------------------

let articleCandidates: Array<{
  id: string;
  title: string;
  excerpt: string | null;
  wordCount: number | null;
}> = [];

let questionsByArticle: Record<
  string,
  Array<{ id: string; question: string; options: unknown; correctIndex: number }>
> = {};

before(() => {
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        article: {
          findMany: async () => articleCandidates,
        },
        quizQuestion: {
          findMany: async (opts: { where: { articleId: string } }) =>
            questionsByArticle[opts.where.articleId] ?? [],
        },
      },
    },
  });

  mock.module("@/lib/article-library", {
    namedExports: {
      publicListableArticleWhere: () => ({}),
    },
  });

  mock.module("@/lib/learning/primitives", {
    namedExports: {
      parseStringArray: (raw: unknown) => {
        if (Array.isArray(raw)) return raw.filter((v) => typeof v === "string");
        return [];
      },
    },
  });
});

let placementModule: typeof import("@/lib/learning/placement-passage");

beforeEach(async () => {
  articleCandidates = [];
  questionsByArticle = {};
  placementModule = await import("@/lib/learning/placement-passage");
});

describe("placement-passage constants", () => {
  test("MIN_PLACEMENT_QUESTIONS is at least 3", () => {
    assert.ok(placementModule.MIN_PLACEMENT_QUESTIONS >= 3);
  });

  test("MAX_PLACEMENT_QUESTIONS is at least MIN_PLACEMENT_QUESTIONS", () => {
    assert.ok(
      placementModule.MAX_PLACEMENT_QUESTIONS >= placementModule.MIN_PLACEMENT_QUESTIONS,
    );
  });
});

describe("loadPlacementPassage", () => {
  test("returns null when no candidate articles exist", async () => {
    articleCandidates = [];
    const result = await placementModule.loadPlacementPassage("B1");
    assert.equal(result, null);
  });

  test("returns null when candidates lack sufficient valid questions", async () => {
    articleCandidates = [
      { id: "a1", title: "Test", excerpt: null, wordCount: 200 },
    ];
    questionsByArticle = {
      a1: [
        { id: "q1", question: "What?", options: ["a", "b"], correctIndex: 0 },
        { id: "q2", question: "Why?", options: ["c", "d"], correctIndex: 1 },
        // Only 2 questions — below MIN_PLACEMENT_QUESTIONS
      ],
    };
    const result = await placementModule.loadPlacementPassage("A2");
    assert.equal(result, null);
  });

  test("returns a passage when an article has enough valid questions", async () => {
    articleCandidates = [
      { id: "a1", title: "Hello World", excerpt: "Intro", wordCount: 150 },
    ];
    questionsByArticle = {
      a1: [
        { id: "q1", question: "Q1?", options: ["a", "b", "c"], correctIndex: 0 },
        { id: "q2", question: "Q2?", options: ["x", "y"], correctIndex: 1 },
        { id: "q3", question: "Q3?", options: ["m", "n", "o"], correctIndex: 2 },
      ],
    };

    const result = await placementModule.loadPlacementPassage("B1");
    assert.ok(result);
    assert.equal(result.articleId, "a1");
    assert.equal(result.seedLevel, "B1");
    assert.equal(result.title, "Hello World");
    assert.equal(result.excerpt, "Intro");
    assert.equal(result.wordCount, 150);
    assert.equal(result.questions.length, 3);
  });

  test("skips articles with invalid questions and tries the next candidate", async () => {
    articleCandidates = [
      { id: "bad", title: "Bad", excerpt: null, wordCount: 100 },
      { id: "good", title: "Good", excerpt: "Yes", wordCount: 300 },
    ];
    questionsByArticle = {
      bad: [
        // correctIndex out of bounds — will be filtered out
        { id: "q1", question: "Q?", options: ["a"], correctIndex: 5 },
        { id: "q2", question: "Q?", options: ["a"], correctIndex: 5 },
        { id: "q3", question: "Q?", options: ["a"], correctIndex: 5 },
      ],
      good: [
        { id: "q4", question: "Q4?", options: ["a", "b"], correctIndex: 0 },
        { id: "q5", question: "Q5?", options: ["c", "d"], correctIndex: 1 },
        { id: "q6", question: "Q6?", options: ["e", "f"], correctIndex: 0 },
      ],
    };

    const result = await placementModule.loadPlacementPassage("B2");
    assert.ok(result);
    assert.equal(result.articleId, "good");
  });

  test("filters questions with empty options", async () => {
    articleCandidates = [
      { id: "a1", title: "T", excerpt: null, wordCount: null },
    ];
    questionsByArticle = {
      a1: [
        { id: "q1", question: "Q1?", options: ["a", "b"], correctIndex: 0 },
        { id: "q2", question: "Q2?", options: [], correctIndex: 0 }, // filtered out (< 2 options)
        { id: "q3", question: "Q3?", options: ["x", "y", "z"], correctIndex: 1 },
        { id: "q4", question: "Q4?", options: ["m", "n"], correctIndex: 0 },
      ],
    };

    const result = await placementModule.loadPlacementPassage("A2");
    assert.ok(result);
    assert.equal(result.questions.length, 3);
    assert.equal(result.wordCount, 0); // null wordCount → 0
  });

  test("question correctIndex must be within options bounds", async () => {
    articleCandidates = [
      { id: "a1", title: "T", excerpt: null, wordCount: 200 },
    ];
    questionsByArticle = {
      a1: [
        { id: "q1", question: "Q1?", options: ["a", "b"], correctIndex: 2 }, // out of bounds
        { id: "q2", question: "Q2?", options: ["c", "d"], correctIndex: -1 }, // negative
        { id: "q3", question: "Q3?", options: ["e", "f"], correctIndex: 0 }, // valid
      ],
    };

    // Only 1 valid question, below minimum → null
    const result = await placementModule.loadPlacementPassage("B1");
    assert.equal(result, null);
  });
});
