import { test } from "node:test";
import assert from "node:assert/strict";
import {
  estimateTokens,
  tokensToChars,
  clampToTokens,
  chunkText,
  chunkForFeature,
  boundedSampleForFeature,
  featureContext,
  resolveInputBudget,
  hashContent,
  promptVersionFor,
  aiContentCacheKey,
} from "@/lib/ai/chunking";

function buildLongText(sentences: number): string {
  const parts: string[] = [];
  for (let i = 0; i < sentences; i++) {
    parts.push(`This is sentence number ${i} with a little filler content to add length.`);
  }
  return parts.join(" ");
}

test("estimateTokens is monotonic and over-estimates", () => {
  assert.equal(estimateTokens(""), 0);
  const a = "hello world";
  const b = "hello world, this is more text";
  assert.ok(estimateTokens(a) <= estimateTokens(b));
  // chars≈4 heuristic, rounded up.
  assert.equal(estimateTokens("abcd"), 1);
  assert.equal(estimateTokens("abcde"), 2);
  // Monotonic under concatenation.
  for (let i = 0; i < 50; i++) {
    const base = "x".repeat(i);
    assert.ok(estimateTokens(base) <= estimateTokens(base + "y"));
  }
});

test("tokensToChars is the inverse scale of the estimator", () => {
  assert.equal(tokensToChars(0), 0);
  assert.equal(tokensToChars(10), 40);
});

test("clampToTokens never exceeds the cap", () => {
  const text = buildLongText(100);
  const clamped = clampToTokens(text, 50);
  assert.ok(estimateTokens(clamped) <= 50);
  // Short text passes through unchanged.
  assert.equal(clampToTokens("short", 50), "short");
});

test("chunkText keeps every chunk within the cap", () => {
  const text = buildLongText(60);
  const maxTokens = 40;
  const chunks = chunkText(text, maxTokens, 0);
  assert.ok(chunks.length > 1, "long text should be split into multiple chunks");
  for (const chunk of chunks) {
    assert.ok(
      estimateTokens(chunk) <= maxTokens,
      `chunk exceeded cap: ${estimateTokens(chunk)} > ${maxTokens}`,
    );
  }
});

test("chunkText covers all sentences (no content dropped)", () => {
  const text = buildLongText(40);
  const chunks = chunkText(text, 40, 0);
  // Every sentence index should appear somewhere across the chunks.
  const joined = chunks.join(" ");
  for (let i = 0; i < 40; i++) {
    assert.ok(joined.includes(`sentence number ${i} `), `missing sentence ${i}`);
  }
});

test("chunkText overlap repeats trailing context between chunks", () => {
  const text = buildLongText(40);
  // Overlap must be at least one sentence's worth of tokens to carry context.
  const noOverlap = chunkText(text, 60, 0);
  const withOverlap = chunkText(text, 60, 30);
  assert.ok(noOverlap.length >= 2);
  assert.ok(withOverlap.length >= 2);
  // With overlap the total character volume is larger (context repeated).
  const lenNo = noOverlap.join("").length;
  const lenOv = withOverlap.join("").length;
  assert.ok(lenOv > lenNo, "overlap should repeat some context");
  // Each overlapped chunk still respects the cap.
  for (const chunk of withOverlap) {
    assert.ok(estimateTokens(chunk) <= 60);
  }
});

test("chunkText handles empty and tiny inputs", () => {
  assert.deepEqual(chunkText("", 100), []);
  assert.deepEqual(chunkText("   ", 100), []);
  assert.deepEqual(chunkText("hello", 100), ["hello"]);
});

test("chunkText hard-splits a single oversized token", () => {
  const giant = "a".repeat(1000);
  const chunks = chunkText(giant, 20, 0);
  assert.ok(chunks.length > 1);
  for (const chunk of chunks) {
    assert.ok(estimateTokens(chunk) <= 20);
  }
  assert.equal(chunks.join(""), giant);
});

test("translation feature uses full-coverage chunking", () => {
  const ctx = featureContext("translation");
  assert.equal(ctx.strategy, "chunk-full");
  // Build text larger than the translation budget so it must split.
  const budget = resolveInputBudget("translation");
  const text = buildLongText(Math.ceil((budget * 4) / 60) + 50);
  const chunks = chunkForFeature(text, "translation");
  assert.ok(chunks.length > 1, "long article should produce multiple translation chunks");
  for (const chunk of chunks) {
    assert.ok(estimateTokens(chunk) <= budget);
  }
  // Full coverage: concatenated chunks contain every sentence.
  const joined = chunks.join(" ");
  const sentenceCount = (text.match(/sentence number/g) ?? []).length;
  for (let i = 0; i < sentenceCount; i++) {
    assert.ok(joined.includes(`sentence number ${i} `), `translation dropped sentence ${i}`);
  }
});

test("boundedSampleForFeature clamps sampled features to their budget", () => {
  const text = buildLongText(500);
  for (const feature of ["vocabulary", "quiz", "tags", "difficulty"]) {
    const budget = resolveInputBudget(feature);
    const sample = boundedSampleForFeature(text, feature);
    assert.ok(estimateTokens(sample) <= budget, `${feature} sample exceeded budget`);
  }
});

test("resolveInputBudget honors an explicit model context window", () => {
  // A tiny context window shrinks the usable budget below the feature default.
  const tiny = resolveInputBudget("vocabulary", 400);
  assert.ok(tiny <= 300, "should reserve ~25% of a tiny window");
  assert.ok(tiny >= 1);
});

test("hashContent is stable for identical text and changes on edit", () => {
  const a = "The quick brown fox.";
  const b = "The quick brown fox.";
  const c = "The quick brown fox!";
  assert.equal(hashContent(a), hashContent(b));
  assert.notEqual(hashContent(a), hashContent(c));
  assert.equal(hashContent(a).length, 16);
});

test("repeated small interactions over unchanged content reuse the cache key", () => {
  const content = buildLongText(200);
  const k1 = aiContentCacheKey("vocabulary", "article-1", content);
  const k2 = aiContentCacheKey("vocabulary", "article-1", content);
  assert.equal(k1, k2, "same feature+scope+content must yield the same key");

  // An article edit busts the key.
  const k3 = aiContentCacheKey("vocabulary", "article-1", content + " extra.");
  assert.notEqual(k1, k3);

  // A different feature/prompt version is a different key.
  const k4 = aiContentCacheKey("quiz", "article-1", content);
  assert.notEqual(k1, k4);
  assert.ok(k1.startsWith(promptVersionFor("vocabulary")));
});
