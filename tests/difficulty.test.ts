import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fleschReadingEase,
  heuristicDifficulty,
  parseLevel,
  assessDifficulty,
  ensureArticleDifficulties,
  getOrCreateArticleDifficulty,
} from "@/lib/difficulty";
import { levelRank, isDifficultyLevel } from "@/lib/leveling/cefr-primitives";
import { prisma } from "@/lib/prisma";

test("fleschReadingEase returns null for too-little text", () => {
  assert.equal(fleschReadingEase("Short text."), null);
});

test("fleschReadingEase scores longer text and easy reads higher than hard", () => {
  const easy = Array.from({ length: 30 }, () => "The cat sat on the mat.").join(" ");
  const hard = Array.from(
    { length: 30 },
    () => "Consequently, the multifaceted epistemological framework necessitates reconsideration.",
  ).join(" ");
  const easyScore = fleschReadingEase(easy);
  const hardScore = fleschReadingEase(hard);
  assert.ok(easyScore !== null && hardScore !== null);
  assert.ok((easyScore as number) > (hardScore as number));
});

test("heuristicDifficulty returns a CEFR level + 0..100 score", () => {
  const text = "<p>" + Array.from({ length: 40 }, () => "The dog ran fast.").join(" ") + "</p>";
  const { level, score } = heuristicDifficulty(text);
  assert.ok(isDifficultyLevel(level));
  assert.ok(score >= 0 && score <= 100);
});

test("heuristicDifficulty falls back to B1/50 when unscorable", () => {
  assert.deepEqual(heuristicDifficulty("<p>tiny</p>"), { level: "B1", score: 50 });
});

test("parseLevel extracts the first CEFR token from model output", () => {
  assert.equal(parseLevel("The level is b2 overall."), "B2");
  assert.equal(parseLevel("A1"), "A1");
  assert.equal(parseLevel("no level here"), null);
});

test("levelRank and isDifficultyLevel", () => {
  assert.equal(levelRank("A1"), 0);
  assert.equal(levelRank("C2"), 5);
  assert.equal(levelRank("ZZ"), -1);
  assert.equal(isDifficultyLevel("B1"), true);
  assert.equal(isDifficultyLevel("XX"), false);
  assert.equal(isDifficultyLevel(7), false);
});

// ---------------------------------------------------------------------------
// fleschReadingEase — word-count boundary
//
// NOTE — SOURCE OBSERVATION: countSyllables() has a dead branch at lines 48-49
// (`if (!w) return 0`) — it is unreachable because fleschReadingEase only
// passes words extracted by /[A-Za-z]+/, which always contain at least one
// letter, so `w` after stripping non-alpha chars is never empty.
// ---------------------------------------------------------------------------

test("fleschReadingEase returns null for a 19-word passage (below the 20-word minimum)", () => {
  // Exactly 19 alphabetic words; words.length < 20 → null.
  const nineteen = "The cat sat on the mat and the big dog ran fast in the old dark blue red room.";
  assert.equal(fleschReadingEase(nineteen), null);
});

test("fleschReadingEase returns a numeric score for a 20-word passage", () => {
  // Adding one word pushes the count to 20, which is the minimum for scoring.
  const twenty = "The cat sat on the mat and the big dog ran fast in the old dark blue red room here.";
  const score = fleschReadingEase(twenty);
  assert.ok(score !== null, "expected a number, got null");
  assert.ok(typeof score === "number");
});

// ---------------------------------------------------------------------------
// heuristicDifficulty — covers all easeToLevel branches (A2 through C2)
//
// Each sentence below has exactly 10 words.  Word syllable counts are chosen
// to produce a predictable ease value (Flesch = 206.835 − 1.015·wps − 84.6·spw)
// that falls in the desired CEFR band:
//
//   A2  ease ≈ 86.7  (spw = 1.3, wps = 10)  — 3 two-syl, 7 one-syl
//   B1  ease ≈ 78.2  (spw = 1.4, wps = 10)  — 4 two-syl, 6 one-syl
//   B2  ease ≈ 61.3  (spw = 1.6, wps = 10)  — 6 two-syl, 4 one-syl
//   C1  ease ≈ 52.9  (spw = 1.7, wps = 10)  — 7 two-syl, 3 one-syl
//   C2  ease ≈ 35.9  (spw = 1.9, wps = 10)  — 9 two-syl, 1 one-syl
//
// Two-syllable words that the heuristic agrees are two syllables:
// basket(2), garden(2), summer(2), winter(2), butter(2), sister(2), pepper(2), pattern(2), mental(2)
// ---------------------------------------------------------------------------

function wrap(sentence: string, n = 25): string {
  return "<p>" + Array.from({ length: n }, () => sentence).join(" ") + "</p>";
}

test("heuristicDifficulty returns level 'A2' for slightly-complex text (ease ≈ 87)", () => {
  // 7 one-syl + 3 two-syl = 13 syllables, wps=10 → ease ≈ 86.7
  const html = wrap("The cat ran fast past big and basket garden summer.");
  const { level, score } = heuristicDifficulty(html);
  assert.equal(level, "A2");
  assert.ok(score > 0 && score <= 100);
});

test("heuristicDifficulty returns level 'B1' for moderately-complex text (ease ≈ 78)", () => {
  // 6 one-syl + 4 two-syl = 14 syllables, wps=10 → ease ≈ 78.2
  const html = wrap("The cat ran fast big and basket garden summer winter.");
  const { level, score } = heuristicDifficulty(html);
  assert.equal(level, "B1");
  assert.ok(score > 0 && score <= 100);
});

test("heuristicDifficulty returns level 'B2' for upper-intermediate text (ease ≈ 61)", () => {
  // 4 one-syl + 6 two-syl = 16 syllables, wps=10 → ease ≈ 61.3
  const html = wrap("The cat ran and basket garden summer winter butter sister.");
  const { level, score } = heuristicDifficulty(html);
  assert.equal(level, "B2");
  assert.ok(score > 0 && score <= 100);
});

test("heuristicDifficulty returns level 'C1' for advanced text (ease ≈ 53)", () => {
  // 3 one-syl + 7 two-syl = 17 syllables, wps=10 → ease ≈ 52.9
  const html = wrap("The cat and basket garden summer winter butter sister pepper.");
  const { level, score } = heuristicDifficulty(html);
  assert.equal(level, "C1");
  assert.ok(score > 0 && score <= 100);
});

test("heuristicDifficulty returns level 'C2' for very-advanced text (ease ≈ 36)", () => {
  // 1 one-syl + 9 two-syl = 19 syllables, wps=10 → ease ≈ 35.9
  const html = wrap("The basket garden summer winter butter sister pepper pattern mental.");
  const { level, score } = heuristicDifficulty(html);
  assert.equal(level, "C2");
  assert.ok(score > 0 && score <= 100);
});

// ---------------------------------------------------------------------------
// parseLevel — additional edge cases
// ---------------------------------------------------------------------------

test("parseLevel returns null for an empty string", () => {
  assert.equal(parseLevel(""), null);
});

test("parseLevel returns the first CEFR token when multiple tokens are present", () => {
  assert.equal(parseLevel("starts at C2 but could be B1 for some"), "C2");
});

test("parseLevel recognises all six CEFR levels in lowercase", () => {
  for (const [input, expected] of [
    ["a1", "A1"], ["a2", "A2"], ["b1", "B1"],
    ["b2", "B2"], ["c1", "C1"], ["c2", "C2"],
  ] as const) {
    assert.equal(parseLevel(input), expected, `parseLevel(${JSON.stringify(input)}) should be ${expected}`);
  }
});

test("parseLevel ignores strings that look like CEFR but are not valid tokens", () => {
  assert.equal(parseLevel("D1 is not a valid CEFR level"), null);
});

// ---------------------------------------------------------------------------
// assessDifficulty — heuristic path (no real AI in test env)
// ---------------------------------------------------------------------------

test("assessDifficulty returns a heuristic result with source 'heuristic' when text is sufficient", async () => {
  const content = wrap("The cat ran fast big and basket garden summer winter.");
  const result = await assessDifficulty("Test Article", content);
  assert.ok(isDifficultyLevel(result.level), `expected a valid level, got ${result.level}`);
  assert.ok(result.score >= 0 && result.score <= 100);
  assert.equal(result.source, "heuristic");
});

test("assessDifficulty falls back to B1/50/heuristic for too-short content", async () => {
  const result = await assessDifficulty("Tiny", "<p>tiny</p>");
  assert.equal(result.level, "B1");
  assert.equal(result.score, 50);
  assert.equal(result.source, "heuristic");
});

// ---------------------------------------------------------------------------
// ensureArticleDifficulties — no-prisma paths
// ---------------------------------------------------------------------------

test("ensureArticleDifficulties returns an empty map for an empty article list", async () => {
  const map = await ensureArticleDifficulties([]);
  assert.equal(map.size, 0);
});

test("ensureArticleDifficulties returns cached results for articles that already have a valid difficulty and score", async () => {
  const articles = [
    { id: "a1", title: "T1", content: "<p>c</p>", difficulty: "A1", difficultyScore: 8 },
    { id: "a2", title: "T2", content: "<p>c</p>", difficulty: "C2", difficultyScore: 64 },
  ];
  const map = await ensureArticleDifficulties(articles);
  assert.equal(map.size, 2);
  assert.deepEqual(map.get("a1"), { articleId: "a1", level: "A1", score: 8, source: "cache" });
  assert.deepEqual(map.get("a2"), { articleId: "a2", level: "C2", score: 64, source: "cache" });
});

test("ensureArticleDifficulties uses levelToScore when difficultyScore is null", async () => {
  // B2 → rank 3, levelToScore = round((3.5/6)*100) = 58
  const articles = [{ id: "x1", title: "T", content: "<p>c</p>", difficulty: "B2", difficultyScore: null }];
  const map = await ensureArticleDifficulties(articles);
  const entry = map.get("x1");
  assert.ok(entry !== undefined);
  assert.equal(entry!.level, "B2");
  assert.equal(entry!.score, 58);
  assert.equal(entry!.source, "cache");
});

// ---------------------------------------------------------------------------
// ensureArticleDifficulties — heuristic path (requires prisma stub)
// ---------------------------------------------------------------------------

test("ensureArticleDifficulties computes heuristic difficulty and persists via prisma.article.update", async () => {
  const orig = (prisma as unknown as Record<string, unknown>).article;
  const updatedIds: string[] = [];
  (prisma as unknown as Record<string, unknown>).article = {
    update: async ({ where }: { where: { id: string } }) => {
      updatedIds.push(where.id);
      return {};
    },
  };
  try {
    const content = wrap("The cat ran fast big and basket garden summer winter.");
    const articles = [
      { id: "h1", title: "T1", content, difficulty: null, difficultyScore: null },
      { id: "h2", title: "T2", content: "<p>tiny</p>", difficulty: null, difficultyScore: null },
    ];
    const map = await ensureArticleDifficulties(articles);

    assert.equal(map.size, 2);
    assert.equal(map.get("h1")!.source, "heuristic");
    assert.ok(isDifficultyLevel(map.get("h1")!.level));
    assert.equal(map.get("h2")!.level, "B1");
    // Articles are mutated in place
    assert.ok(isDifficultyLevel(articles[0].difficulty));
    assert.ok(isDifficultyLevel(articles[1].difficulty));
    // Both persisted via prisma.article.update
    assert.deepEqual(updatedIds.sort(), ["h1", "h2"]);
  } finally {
    (prisma as unknown as Record<string, unknown>).article = orig;
  }
});

// ---------------------------------------------------------------------------
// getOrCreateArticleDifficulty — all paths (requires prisma stub)
// ---------------------------------------------------------------------------

test("getOrCreateArticleDifficulty returns null when the article is not found", async () => {
  const orig = (prisma as unknown as Record<string, unknown>).article;
  (prisma as unknown as Record<string, unknown>).article = {
    findUnique: async () => null,
  };
  try {
    const result = await getOrCreateArticleDifficulty("missing-id");
    assert.equal(result, null);
  } finally {
    (prisma as unknown as Record<string, unknown>).article = orig;
  }
});

test("getOrCreateArticleDifficulty returns cached difficulty when the article already has a valid level", async () => {
  const orig = (prisma as unknown as Record<string, unknown>).article;
  (prisma as unknown as Record<string, unknown>).article = {
    findUnique: async ({ where }: { where: { id: string } }) => ({
      id: where.id,
      title: "Cached Article",
      content: "<p>c</p>",
      difficulty: "B1",
      difficultyScore: 22,
    }),
  };
  try {
    const result = await getOrCreateArticleDifficulty("art-1");
    assert.ok(result !== null);
    assert.equal(result!.articleId, "art-1");
    assert.equal(result!.level, "B1");
    assert.equal(result!.score, 22);
    assert.equal(result!.source, "cache");
  } finally {
    (prisma as unknown as Record<string, unknown>).article = orig;
  }
});

test("getOrCreateArticleDifficulty uses levelToScore when difficultyScore is null in cached result", async () => {
  // C1 → rank 4, levelToScore = round((4.5/6)*100) = 75
  const orig = (prisma as unknown as Record<string, unknown>).article;
  (prisma as unknown as Record<string, unknown>).article = {
    findUnique: async ({ where }: { where: { id: string } }) => ({
      id: where.id,
      title: "C1 Article",
      content: "<p>c</p>",
      difficulty: "C1",
      difficultyScore: null,
    }),
  };
  try {
    const result = await getOrCreateArticleDifficulty("art-2");
    assert.ok(result !== null);
    assert.equal(result!.level, "C1");
    assert.equal(result!.score, 75);
    assert.equal(result!.source, "cache");
  } finally {
    (prisma as unknown as Record<string, unknown>).article = orig;
  }
});

test("getOrCreateArticleDifficulty assesses and persists difficulty when none is cached", async () => {
  const orig = (prisma as unknown as Record<string, unknown>).article;
  let updateArgs: Record<string, unknown> | null = null;
  const content = wrap("The cat ran fast big and basket garden summer winter.");
  (prisma as unknown as Record<string, unknown>).article = {
    findUnique: async ({ where }: { where: { id: string } }) => ({
      id: where.id,
      title: "Unrated Article",
      content,
      difficulty: null,
      difficultyScore: null,
    }),
    update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
      updateArgs = args;
      return {};
    },
  };
  try {
    const result = await getOrCreateArticleDifficulty("art-3");
    assert.ok(result !== null);
    assert.equal(result!.articleId, "art-3");
    assert.ok(isDifficultyLevel(result!.level));
    assert.ok(result!.score >= 0 && result!.score <= 100);
    assert.equal(result!.source, "heuristic");
    // Verify prisma.article.update was called with the assessed values
    assert.ok(updateArgs !== null, "expected prisma.article.update to be called");
    assert.equal((updateArgs as any).where.id, "art-3");
    assert.ok(isDifficultyLevel((updateArgs as any).data.difficulty));
  } finally {
    (prisma as unknown as Record<string, unknown>).article = orig;
  }
});
