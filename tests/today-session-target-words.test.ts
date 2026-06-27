/**
 * Today Session — target saved-word selection (#791).
 *
 * Verifies article-linked due priority, oldest-due fallback, weak/recent
 * top-up, no-words behaviour, and that only ids are returned (privacy).
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

type WordRow = {
  id: string;
  articleId: string | null;
  dueAt: Date | null;
  easeFactor: number;
  createdAt: Date;
  lastReviewedAt: Date | null;
};

let words: WordRow[] = [];
let lastSelect: Record<string, unknown> | null = null;

before(() => {
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        savedWord: {
          findMany: async ({ select }: { select: Record<string, unknown> }) => {
            lastSelect = select;
            return words;
          },
        },
      },
    },
  });
});

beforeEach(() => {
  words = [];
  lastSelect = null;
});

const NOW = new Date("2026-06-27T12:00:00Z");
const past = (days: number) =>
  new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);

function word(p: Partial<WordRow> & { id: string }): WordRow {
  return {
    articleId: null,
    dueAt: null,
    easeFactor: 2.5,
    createdAt: past(30),
    lastReviewedAt: null,
    ...p,
  };
}

test("prioritizes due/never-reviewed words linked to the primary article", async () => {
  const { selectTargetWordIds } = await import(
    "@/lib/engagement/today-session/target-words"
  );
  words = [
    // Linked + due → should come first.
    word({ id: "linked-due", articleId: "a1", dueAt: past(2) }),
    // Linked + never reviewed → also prioritized.
    word({ id: "linked-new", articleId: "a1", dueAt: null }),
    // Unlinked but due → after linked.
    word({ id: "other-due", articleId: "a2", dueAt: past(5) }),
    // Not due, not linked → only a top-up candidate.
    word({ id: "future", articleId: "a2", dueAt: new Date(NOW.getTime() + 1e9) }),
  ];
  const res = await selectTargetWordIds({
    userId: "u1",
    primaryArticleId: "a1",
    now: NOW,
  });
  assert.equal(res.targetSavedWordIds[0] === "linked-due" || res.targetSavedWordIds[0] === "linked-new", true);
  // Both linked words precede the unlinked due word.
  const idx = (id: string) => res.targetSavedWordIds.indexOf(id);
  assert.ok(idx("linked-due") < idx("other-due"));
  assert.ok(idx("linked-new") < idx("other-due"));
  assert.equal(res.reviewTargetCount, res.targetSavedWordIds.length);
});

test("falls back to oldest-due words when none are article-linked", async () => {
  const { selectTargetWordIds } = await import(
    "@/lib/engagement/today-session/target-words"
  );
  words = [
    word({ id: "due-old", dueAt: past(10) }),
    word({ id: "due-new", dueAt: past(1) }),
    word({ id: "not-due", dueAt: new Date(NOW.getTime() + 1e9) }),
  ];
  const res = await selectTargetWordIds({
    userId: "u1",
    primaryArticleId: "a-none",
    now: NOW,
  });
  // Oldest-due first.
  assert.equal(res.targetSavedWordIds[0], "due-old");
  assert.ok(
    res.targetSavedWordIds.indexOf("due-old") <
      res.targetSavedWordIds.indexOf("due-new"),
  );
});

test("caps selection at the max target count", async () => {
  const { selectTargetWordIds } = await import(
    "@/lib/engagement/today-session/target-words"
  );
  words = Array.from({ length: 12 }, (_, i) =>
    word({ id: `w${i}`, dueAt: past(i + 1) }),
  );
  const res = await selectTargetWordIds({
    userId: "u1",
    primaryArticleId: null,
    now: NOW,
  });
  assert.equal(res.targetSavedWordIds.length, 5);
  assert.equal(res.reviewTargetCount, 5);
});

test("returns an empty (valid) selection when there are no saved words", async () => {
  const { selectTargetWordIds } = await import(
    "@/lib/engagement/today-session/target-words"
  );
  words = [];
  const res = await selectTargetWordIds({
    userId: "u1",
    primaryArticleId: "a1",
    now: NOW,
  });
  assert.deepEqual(res.targetSavedWordIds, []);
  assert.equal(res.reviewTargetCount, 0);
});

test("is deterministic across repeated calls on the same state", async () => {
  const { selectTargetWordIds } = await import(
    "@/lib/engagement/today-session/target-words"
  );
  words = [
    word({ id: "b", dueAt: past(3) }),
    word({ id: "a", dueAt: past(3) }), // same dueAt + createdAt → tie broken by id
    word({ id: "c", dueAt: past(1) }),
  ];
  const first = await selectTargetWordIds({
    userId: "u1",
    primaryArticleId: null,
    now: NOW,
  });
  const second = await selectTargetWordIds({
    userId: "u1",
    primaryArticleId: null,
    now: NOW,
  });
  assert.deepEqual(first.targetSavedWordIds, second.targetSavedWordIds);
});

test("privacy: query selects ids/ranking columns only — never word content", async () => {
  const { selectTargetWordIds } = await import(
    "@/lib/engagement/today-session/target-words"
  );
  words = [word({ id: "w1", dueAt: past(1) })];
  await selectTargetWordIds({ userId: "u1", primaryArticleId: null, now: NOW });
  assert.ok(lastSelect);
  // No content columns requested.
  for (const banned of ["word", "explanation", "example", "contextSentence"]) {
    assert.equal(banned in (lastSelect as Record<string, unknown>), false);
  }
});
