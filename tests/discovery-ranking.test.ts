/**
 * Unit tests for the six pure scoring functions in src/lib/discovery-ranking.ts.
 * No mocks, no DB, no I/O — these functions are fully deterministic.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  buildTagMap,
  levelProximityScore,
  levelFitScore,
  freshnessScore,
  freshnessScore01,
  topicInterestScore,
} from "@/lib/discovery-ranking";

// ---------------------------------------------------------------------------
// buildTagMap
// ---------------------------------------------------------------------------

describe("buildTagMap", () => {
  test("returns empty map for empty input", () => {
    assert.deepEqual(buildTagMap([]), new Map());
  });

  test("maps a single row correctly", () => {
    const map = buildTagMap([{ articleId: "a1", tag: { slug: "tech" } }]);
    assert.deepEqual(map.get("a1"), ["tech"]);
  });

  test("groups multiple tags for the same article", () => {
    const map = buildTagMap([
      { articleId: "a1", tag: { slug: "tech" } },
      { articleId: "a1", tag: { slug: "science" } },
      { articleId: "a2", tag: { slug: "history" } },
    ]);
    assert.deepEqual(map.get("a1"), ["tech", "science"]);
    assert.deepEqual(map.get("a2"), ["history"]);
  });

  test("preserves insertion order within an article", () => {
    const map = buildTagMap([
      { articleId: "a1", tag: { slug: "z" } },
      { articleId: "a1", tag: { slug: "a" } },
      { articleId: "a1", tag: { slug: "m" } },
    ]);
    assert.deepEqual(map.get("a1"), ["z", "a", "m"]);
  });
});

// ---------------------------------------------------------------------------
// levelProximityScore
// ---------------------------------------------------------------------------

describe("levelProximityScore", () => {
  const cases: Array<[number, number, number]> = [
    // [articleRank, userRank, expected]
    [2, 2, 30], // perfect match → 30
    [1, 2, 18], // delta=-1 (slightly easy) → 18
    [0, 2, 10], // delta=-2 (easy) → 10
    [5, 9, 5], // delta=-4 (way too easy, <= -3) → 5
    [3, 2, 12], // delta=+1 (slightly hard) → 12
    [4, 2, 3], // delta=+2 (hard) → 3
    [6, 2, 0], // delta=+4 (way too hard) → 0
    [0, 0, 30], // zero ranks, perfect match → 30
  ];

  for (const [articleRank, userRank, expected] of cases) {
    test(`levelProximityScore(${articleRank}, ${userRank}) === ${expected}`, () => {
      assert.equal(levelProximityScore(articleRank, userRank), expected);
    });
  }

  test("delta <= -3 (way too easy) always returns 5", () => {
    assert.equal(levelProximityScore(0, 4), 5); // delta=-4
    assert.equal(levelProximityScore(0, 5), 5); // delta=-5
  });

  test("delta > +2 (way too hard) returns 0", () => {
    assert.equal(levelProximityScore(5, 2), 0); // delta=+3
    assert.equal(levelProximityScore(10, 2), 0); // delta=+8
  });
});

// ---------------------------------------------------------------------------
// levelFitScore
// ---------------------------------------------------------------------------

describe("levelFitScore", () => {
  test("returns 0.5 when articleRank is null", () => {
    assert.equal(levelFitScore(null, 2), 0.5);
  });

  test("returns 0.5 when articleRank is negative", () => {
    assert.equal(levelFitScore(-1, 2), 0.5);
  });

  test("returns 0.5 when userRank is null", () => {
    assert.equal(levelFitScore(2, null), 0.5);
  });

  const cases: Array<[number, number, number]> = [
    // [articleRank, userRank, expected]
    [2, 2, 1], // delta=0, perfect match → 1
    [1, 2, 0.78], // delta=-1 → 0.78
    [3, 2, 0.62], // delta=+1 → 0.62
    [0, 2, 0.5], // delta=-2 → 0.5
    [4, 2, 0.32], // delta=+2 → 0.32
    [5, 2, 0.12], // delta=+3 (default, positive) → 0.12
    [0, 4, 0.2], // delta=-4 (default, negative) → 0.2
  ];

  for (const [articleRank, userRank, expected] of cases) {
    test(`levelFitScore(${articleRank}, ${userRank}) === ${expected}`, () => {
      assert.equal(levelFitScore(articleRank, userRank), expected);
    });
  }

  test("very-too-hard delta (positive > 2) returns 0.12", () => {
    assert.equal(levelFitScore(10, 2), 0.12);
  });

  test("very-too-easy delta (negative < -2) returns 0.2", () => {
    assert.equal(levelFitScore(0, 5), 0.2);
  });
});

// ---------------------------------------------------------------------------
// freshnessScore
// ---------------------------------------------------------------------------

describe("freshnessScore", () => {
  const now = new Date("2026-06-01T00:00:00Z");

  test("returns 0 when publishedAt is null", () => {
    assert.equal(freshnessScore(null, now), 0);
  });

  const cases: Array<[number, number]> = [
    // [daysAgo, expectedScore]
    [0, 10], // published today → 10
    [7, 10], // exactly 7 days → still 10
    [8, 7], // 8 days → 7
    [30, 7], // exactly 30 days → 7
    [31, 4], // 31 days → 4
    [90, 4], // exactly 90 days → 4
    [91, 2], // 91 days → 2
    [180, 2], // exactly 180 days → 2
    [181, 0], // 181 days → 0
    [365, 0], // 1 year → 0
  ];

  for (const [daysAgo, expected] of cases) {
    test(`${daysAgo} days ago → ${expected}`, () => {
      const publishedAt = new Date(now.getTime() - daysAgo * 86_400_000);
      assert.equal(freshnessScore(publishedAt, now), expected);
    });
  }
});

// ---------------------------------------------------------------------------
// freshnessScore01
// ---------------------------------------------------------------------------

describe("freshnessScore01", () => {
  const now = new Date("2026-06-01T00:00:00Z");

  test("returns 0.1 when publishedAt is null", () => {
    assert.equal(freshnessScore01(null, now), 0.1);
  });

  test("accepts an ISO date string as well as a Date object", () => {
    const dateObj = new Date(now.getTime() - 3 * 86_400_000); // 3 days ago
    const isoStr = dateObj.toISOString();
    assert.equal(freshnessScore01(dateObj, now), freshnessScore01(isoStr, now));
  });

  const cases: Array<[number, number]> = [
    // [daysAgo, expectedScore]
    [0, 1], // today → 1
    [7, 1], // exactly 7 days → 1
    [8, 0.75], // 8 days → 0.75
    [30, 0.75], // exactly 30 days → 0.75
    [31, 0.5], // 31 days → 0.5
    [90, 0.5], // exactly 90 days → 0.5
    [91, 0.3], // 91 days → 0.3
    [180, 0.3], // exactly 180 days → 0.3
    [181, 0.1], // 181 days → 0.1
    [365, 0.1], // 1 year → 0.1
  ];

  for (const [daysAgo, expected] of cases) {
    test(`${daysAgo} days ago → ${expected}`, () => {
      const publishedAt = new Date(now.getTime() - daysAgo * 86_400_000);
      assert.equal(freshnessScore01(publishedAt, now), expected);
    });
  }
});

// ---------------------------------------------------------------------------
// topicInterestScore
// ---------------------------------------------------------------------------

describe("topicInterestScore", () => {
  test("returns 0.5 when topicSet is empty", () => {
    assert.equal(topicInterestScore("tech", ["tag1"], new Set()), 0.5);
    assert.equal(topicInterestScore(null, [], new Set()), 0.5);
  });

  test("returns 1 when category matches a topic", () => {
    assert.equal(topicInterestScore("tech", [], new Set(["tech"])), 1);
    assert.equal(topicInterestScore("science", ["other"], new Set(["science", "tech"])), 1);
  });

  test("returns 0 when no category or tag matches", () => {
    assert.equal(topicInterestScore("history", ["language"], new Set(["tech", "science"])), 0);
    assert.equal(topicInterestScore(null, [], new Set(["tech"])), 0);
  });

  test("single tag match returns 0.4", () => {
    assert.equal(topicInterestScore(null, ["tech"], new Set(["tech"])), 0.4);
  });

  test("two matching tags returns 0.8 (capped)", () => {
    assert.equal(topicInterestScore(null, ["tech", "science"], new Set(["tech", "science"])), 0.8);
  });

  test("three or more matching tags still caps at 0.8", () => {
    assert.equal(
      topicInterestScore(null, ["a", "b", "c"], new Set(["a", "b", "c"])),
      0.8,
    );
  });

  test("category match takes precedence over tag matches", () => {
    assert.equal(topicInterestScore("tech", ["tech"], new Set(["tech"])), 1);
  });

  test("null category falls back to tag matching", () => {
    assert.equal(topicInterestScore(null, ["tech", "science"], new Set(["tech"])), 0.4);
  });
});
