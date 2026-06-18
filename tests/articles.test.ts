import { test } from "node:test";
import assert from "node:assert/strict";
import {
  filterAndSortByLevel,
  readingMinutesFor,
  countWords,
  toListingArticle,
  rankPicks,
} from "@/lib/articles";
import { buildArticle } from "./helpers";

test("countWords ignores HTML tags", () => {
  assert.equal(countWords("<p>one two <b>three</b></p>"), 3);
  assert.equal(countWords("   "), 0);
});

test("readingMinutesFor prefers stored value, then wordCount, then body", () => {
  assert.equal(readingMinutesFor(buildArticle({ readingMinutes: 7 })), 7);
  assert.equal(
    readingMinutesFor(buildArticle({ readingMinutes: null, wordCount: 400 })),
    2,
  );
  const body = "<p>" + Array.from({ length: 200 }, () => "x").join(" ") + "</p>";
  assert.equal(
    readingMinutesFor(buildArticle({ readingMinutes: null, wordCount: null, content: body })),
    1,
  );
  assert.equal(
    readingMinutesFor(buildArticle({ readingMinutes: null, wordCount: null, content: "" })),
    null,
  );
});

test("filterAndSortByLevel filters at/below a level and sorts easiest-first", () => {
  const arts = [
    buildArticle({ id: "c1", difficulty: "C1", difficultyScore: 70 }),
    buildArticle({ id: "a2", difficulty: "A2", difficultyScore: 20 }),
    buildArticle({ id: "b1", difficulty: "B1", difficultyScore: 40 }),
    buildArticle({ id: "none", difficulty: null }),
  ];
  const result = filterAndSortByLevel(arts, "B1");
  assert.deepEqual(result.map((a) => a.id), ["a2", "b1"]);
});

test("filterAndSortByLevel without a cap keeps unassessed (sorted last)", () => {
  const arts = [
    buildArticle({ id: "none", difficulty: null }),
    buildArticle({ id: "a1", difficulty: "A1", difficultyScore: 5 }),
  ];
  const result = filterAndSortByLevel(arts, null);
  assert.deepEqual(result.map((a) => a.id), ["a1", "none"]);
});

test("toListingArticle returns only serializable card fields", () => {
  const card = toListingArticle(
    buildArticle({ id: "x", title: "T", readingMinutes: 4, category: "tech" }),
  );
  assert.deepEqual(Object.keys(card).sort(), [
    "author",
    "category",
    "difficulty",
    "id",
    "readingMinutes",
    "source",
    "title",
  ]);
  assert.equal(card.readingMinutes, 4);
});

test("rankPicks surfaces topic-matching articles ahead, preserving level order", () => {
  const arts = [
    buildArticle({ id: "tech-hard", difficulty: "B2", difficultyScore: 60, category: "tech" }),
    buildArticle({ id: "world-easy", difficulty: "A1", difficultyScore: 5, category: "world" }),
    buildArticle({ id: "tech-easy", difficulty: "A2", difficultyScore: 20, category: "tech" }),
  ];
  const ranked = rankPicks(arts, "C2", ["tech"]);
  assert.deepEqual(ranked.map((a) => a.id), ["tech-easy", "tech-hard", "world-easy"]);
});

test("rankPicks with no topics is the plain level ranking", () => {
  const arts = [
    buildArticle({ id: "b", difficulty: "B1", difficultyScore: 40 }),
    buildArticle({ id: "a", difficulty: "A1", difficultyScore: 5 }),
  ];
  assert.deepEqual(rankPicks(arts, null, []).map((a) => a.id), ["a", "b"]);
});
