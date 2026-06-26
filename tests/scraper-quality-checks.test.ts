/**
 * Fixture-based drift-triage tests for the content extraction quality checker
 * (Issue #739).
 *
 * Tests use fully inline synthetic data — no real network, no database.
 * Each test asserts that a representative good or degraded extraction is
 * classified with the expected QualityGrade and that the relevant signal
 * is present in the result.
 *
 * How to add a new drift case:
 *   1. Reproduce the degraded HTML from the broken provider.
 *   2. Add a test asserting `grade === "warn"` or `"reject"` + the
 *      specific failing `check` name.
 *   3. After fixing the provider, confirm the test flips to `"ok"`.
 */

process.env.LOG_LEVEL = "error";

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  checkContentQuality,
  MIN_WORD_COUNT,
  SHORT_WORD_COUNT,
  MAX_LINK_DENSITY,
  MAX_GARBAGE_RATIO,
  BOILERPLATE_HIT_THRESHOLD,
  type QualityInput,
} from "@/lib/scraper/quality";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns `n` unique-looking words joined by spaces. */
function words(n: number, seed = "word"): string {
  return Array.from({ length: n }, (_, i) => `${seed}${i + 1}`).join(" ");
}

/** Wraps a plain-text body in minimal article HTML. */
function articleHtml(body: string): string {
  return `<p>${body}</p>`;
}

/** Builds a minimal QualityInput with sensible defaults. */
function makeInput(overrides: Partial<QualityInput> & { content: string }): QualityInput {
  const plainLen = overrides.content.replace(/<[^>]*>/g, " ").trim().split(/\s+/).length;
  return {
    title: "Test Article",
    author: "Test Author",
    publishedAt: new Date("2026-01-01T00:00:00Z"),
    wordCount: plainLen,
    sourceUrl: "https://example.com/article/test",
    ...overrides,
  };
}

/** Returns the signal detail for a named check, or undefined. */
function signalFor(result: ReturnType<typeof checkContentQuality>, check: string) {
  return result.signals.find((s) => s.check === check);
}

// ---------------------------------------------------------------------------
// 1. Good article — baseline "ok"
// ---------------------------------------------------------------------------

test("quality/good: well-formed article with all metadata scores ok", () => {
  const input = makeInput({
    content: articleHtml(words(200, "story")),
    author: "Jane Doe",
    publishedAt: new Date("2026-05-01T10:00:00Z"),
  });
  const result = checkContentQuality(input);

  assert.equal(result.grade, "ok");
  assert.ok(result.score >= 90, `score ${result.score} should be ≥ 90`);
  const failed = result.signals.filter((s) => !s.passed).map((s) => s.check);
  assert.deepEqual(failed, [], `no checks should fail for a good article, got: ${failed}`);
});

test("quality/good: score is 100 when all signals pass", () => {
  const input = makeInput({
    content: articleHtml(words(300, "article")),
    author: "John Smith",
    publishedAt: new Date("2026-03-15T08:00:00Z"),
  });
  const result = checkContentQuality(input);

  assert.equal(result.grade, "ok");
  assert.equal(result.score, 100);
});

// ---------------------------------------------------------------------------
// 2. Critical: empty body
// ---------------------------------------------------------------------------

test("quality/reject: empty body is rejected", () => {
  const input = makeInput({ content: "", wordCount: 0 });
  const result = checkContentQuality(input);

  assert.equal(result.grade, "reject");
  assert.equal(signalFor(result, "empty-body")?.passed, false);
});

test("quality/reject: whitespace-only body is rejected", () => {
  const input = makeInput({ content: "   \t\n  ", wordCount: 0 });
  const result = checkContentQuality(input);

  assert.equal(result.grade, "reject");
  assert.equal(signalFor(result, "empty-body")?.passed, false);
});

// ---------------------------------------------------------------------------
// 3. Critical: word count too low
// ---------------------------------------------------------------------------

test(`quality/reject: article with fewer than ${MIN_WORD_COUNT} words is rejected`, () => {
  const body = words(MIN_WORD_COUNT - 1, "short");
  const input = makeInput({ content: articleHtml(body), wordCount: MIN_WORD_COUNT - 1 });
  const result = checkContentQuality(input);

  assert.equal(result.grade, "reject");
  assert.equal(signalFor(result, "word-count")?.passed, false);
  assert.match(signalFor(result, "word-count")?.detail ?? "", /words=\d+/);
});

test(`quality/ok: article with exactly ${MIN_WORD_COUNT} words passes word-count check`, () => {
  const body = words(MIN_WORD_COUNT, "ok");
  const input = makeInput({ content: articleHtml(body), wordCount: MIN_WORD_COUNT });
  const result = checkContentQuality(input);

  assert.equal(signalFor(result, "word-count")?.passed, true);
  assert.notEqual(result.grade, "reject");
});

test(`quality/ok: article with ${SHORT_WORD_COUNT} words passes word-count (no reject)`, () => {
  const body = words(SHORT_WORD_COUNT, "med");
  const input = makeInput({ content: articleHtml(body), wordCount: SHORT_WORD_COUNT });
  const result = checkContentQuality(input);

  assert.equal(signalFor(result, "word-count")?.passed, true);
  assert.notEqual(result.grade, "reject");
});

// ---------------------------------------------------------------------------
// 4. Major: paywall / subscription-gate (drift scenario: scraper captured gate)
// ---------------------------------------------------------------------------

test("quality/warn: paywall marker — 'subscribers only' text triggers warn", () => {
  const body =
    words(100, "intro") +
    " This content is for subscribers only. Please sign in to continue reading.";
  const input = makeInput({ content: articleHtml(body), wordCount: 110 });
  const result = checkContentQuality(input);

  assert.equal(result.grade, "warn");
  assert.equal(signalFor(result, "paywall-marker")?.passed, false);
});

test("quality/warn: paywall marker — 'reached your free article limit'", () => {
  const body =
    words(80, "news") +
    " You have reached your free article limit. Subscribe to continue reading.";
  const input = makeInput({ content: articleHtml(body), wordCount: 90 });
  const result = checkContentQuality(input);

  assert.equal(result.grade, "warn");
  assert.equal(signalFor(result, "paywall-marker")?.passed, false);
});

test("quality/warn: paywall marker — 'sign in to read'", () => {
  const body = words(60, "gate") + " Please sign in to read the full article.";
  const input = makeInput({ content: articleHtml(body), wordCount: 70 });
  const result = checkContentQuality(input);

  assert.equal(result.grade, "warn");
  assert.equal(signalFor(result, "paywall-marker")?.passed, false);
});

test("quality/ok: 'subscribe' in a non-gate context does not trigger paywall check", () => {
  // "subscribe to our newsletter" — should NOT match subscription-gate patterns
  const body = words(200, "article") + " You can subscribe to our newsletter for updates.";
  const input = makeInput({ content: articleHtml(body), wordCount: 210 });
  const result = checkContentQuality(input);

  assert.equal(signalFor(result, "paywall-marker")?.passed, true);
});

// ---------------------------------------------------------------------------
// 5. Major: encoding garbage (drift scenario: charset/encoding issue)
// ---------------------------------------------------------------------------

test("quality/warn: high ratio of replacement chars triggers encoding-garbage", () => {
  // Build a body where replacement chars exceed MAX_GARBAGE_RATIO (2%).
  // 100 words × ~8 chars ≈ 800 chars plain text; 30 U+FFFD = 3.6% > 2%.
  const baseWords = words(100, "encode");
  const garbage = "\uFFFD".repeat(30);
  const body = `${baseWords} ${garbage}`;
  const input = makeInput({ content: articleHtml(body), wordCount: 100 });
  const result = checkContentQuality(input);

  assert.equal(result.grade, "warn");
  assert.equal(signalFor(result, "encoding-garbage")?.passed, false);
  assert.match(signalFor(result, "encoding-garbage")?.detail ?? "", /garbageRatio=/);
});

test("quality/ok: a single stray replacement char stays below the garbage threshold", () => {
  // One U+FFFD in a 1000-char text = 0.1% — well below MAX_GARBAGE_RATIO
  const body = words(200, "clean") + " \uFFFD";
  const input = makeInput({ content: articleHtml(body), wordCount: 200 });
  const result = checkContentQuality(input);

  assert.equal(signalFor(result, "encoding-garbage")?.passed, true);
});

// ---------------------------------------------------------------------------
// 6. Major: excessive link density (drift scenario: index/nav page captured)
// ---------------------------------------------------------------------------

test("quality/warn: nav-heavy page with link density > threshold triggers warn", () => {
  // Build content where most "words" are inside <a> tags (simulates nav page)
  const linkBlock = Array.from(
    { length: 50 },
    (_, i) => `<a href="/article/${i}">headline word${i} topic${i} read</a>`,
  ).join(" ");
  const articleContent = `<p>${words(20, "real")}</p><p>${linkBlock}</p>`;
  const input = makeInput({ content: articleContent, wordCount: 220 });
  const result = checkContentQuality(input);

  assert.equal(result.grade, "warn");
  assert.equal(signalFor(result, "link-density")?.passed, false);
  assert.match(signalFor(result, "link-density")?.detail ?? "", /linkDensity=/);
});

test("quality/ok: article with a few inline links stays below link-density threshold", () => {
  const body =
    `<p>${words(150, "para")}</p>` +
    '<p>Read more at <a href="https://example.com">example.com</a> for details.</p>';
  const input = makeInput({ content: body, wordCount: 155 });
  const result = checkContentQuality(input);

  assert.equal(signalFor(result, "link-density")?.passed, true);
});

// ---------------------------------------------------------------------------
// 7. Major: boilerplate-heavy (drift scenario: footer/legal page captured)
// ---------------------------------------------------------------------------

test(`quality/warn: ${BOILERPLATE_HIT_THRESHOLD}+ boilerplate patterns trigger warn`, () => {
  // Simulate a scraper that captured a footer/legal page
  const boilerplate = [
    "Copyright © 2026 ExampleCorp.",
    "All rights reserved.",
    "Privacy Policy. Terms of Service. Cookie Settings.",
    "Do not sell my personal information.",
    "Advertise with us for premium placement.",
  ].join(" ");
  const body = words(120, "article") + " " + boilerplate;
  const input = makeInput({ content: `<p>${body}</p>`, wordCount: 140 });
  const result = checkContentQuality(input);

  assert.equal(result.grade, "warn");
  assert.equal(signalFor(result, "boilerplate-heavy")?.passed, false);
  assert.match(signalFor(result, "boilerplate-heavy")?.detail ?? "", /boilerplateHits=\d+/);
});

test(`quality/ok: fewer than ${BOILERPLATE_HIT_THRESHOLD} boilerplate hints does not trigger`, () => {
  // One copyright line in a full article is normal
  const body = words(200, "article") + " © 2026 News Corp.";
  const input = makeInput({ content: `<p>${body}</p>`, wordCount: 200 });
  const result = checkContentQuality(input);

  assert.equal(signalFor(result, "boilerplate-heavy")?.passed, true);
});

// ---------------------------------------------------------------------------
// 8. Advisory: missing author / date (warn only when combined with other issues)
// ---------------------------------------------------------------------------

test("quality/ok: missing author alone does not produce a warn grade", () => {
  const input = makeInput({
    content: articleHtml(words(200, "noauthor")),
    author: null,
    publishedAt: new Date("2026-01-01T00:00:00Z"),
  });
  const result = checkContentQuality(input);

  assert.equal(result.grade, "ok");
  assert.equal(signalFor(result, "missing-author")?.passed, false);
});

test("quality/ok: missing date alone does not produce a warn grade", () => {
  const input = makeInput({
    content: articleHtml(words(200, "nodate")),
    author: "Some Author",
    publishedAt: null,
  });
  const result = checkContentQuality(input);

  assert.equal(result.grade, "ok");
  assert.equal(signalFor(result, "missing-date")?.passed, false);
});

test("quality/ok: missing both author and date does not produce a warn grade", () => {
  const input = makeInput({
    content: articleHtml(words(200, "noauthor")),
    author: null,
    publishedAt: null,
  });
  const result = checkContentQuality(input);

  // Advisory deductions only (10 pts) — no major warn signals
  assert.equal(result.grade, "ok");
  assert.equal(result.score, 90);
});

// ---------------------------------------------------------------------------
// 9. Combined: multiple major signals (cumulative degradation)
// ---------------------------------------------------------------------------

test("quality/warn: paywall + high link density both fire for a gated index page", () => {
  const linkBlock = Array.from(
    { length: 40 },
    (_, i) => `<a href="/s/${i}">article story headline ${i}</a>`,
  ).join(" ");
  const body =
    `<p>${words(60, "gate")}</p>` +
    `<p>${linkBlock}</p>` +
    "<p>Sign in to read the full article.</p>";
  const input = makeInput({ content: body, wordCount: 200 });
  const result = checkContentQuality(input);

  assert.equal(result.grade, "warn");
  assert.equal(signalFor(result, "paywall-marker")?.passed, false);
  assert.equal(signalFor(result, "link-density")?.passed, false);
  assert.ok(result.score < 60, `score ${result.score} should be < 60 for dual major signals`);
});

// ---------------------------------------------------------------------------
// 10. Composite score properties
// ---------------------------------------------------------------------------

test("quality/score: score is always in [0, 100]", () => {
  // Worst possible case: empty body, no author, no date
  const worst = makeInput({ content: "", wordCount: 0, author: null, publishedAt: null });
  const result = checkContentQuality(worst);

  assert.ok(result.score >= 0 && result.score <= 100, `score ${result.score} out of range`);
});

test("quality/score: all failing major signals still produce score >= 0 (no negative)", () => {
  const linkBlock = Array.from(
    { length: 60 },
    (_, i) => `<a href="/x/${i}">text word${i} more${i}</a>`,
  ).join(" ");
  const body =
    `<p>${linkBlock}</p>` +
    "<p>Subscribe to read this exclusive content for members only.</p>" +
    "<p>Copyright © 2026. All rights reserved. Privacy Policy. Terms of Service. Cookie Settings. Advertise with us. Do not sell my data.</p>" +
    `<p>${"\uFFFD".repeat(15)} more text here.</p>`;
  const input = makeInput({ content: body, wordCount: 180, author: null, publishedAt: null });
  const result = checkContentQuality(input);

  assert.ok(result.score >= 0, `score must never go below 0, got ${result.score}`);
  assert.equal(result.grade, "warn");
});

// ---------------------------------------------------------------------------
// 11. Signal completeness
// ---------------------------------------------------------------------------

test("quality/signals: result always contains all expected check names", () => {
  const expectedChecks = [
    "empty-body",
    "word-count",
    "paywall-marker",
    "encoding-garbage",
    "link-density",
    "boilerplate-heavy",
    "missing-author",
    "missing-date",
  ];

  const input = makeInput({ content: articleHtml(words(200, "sig")) });
  const result = checkContentQuality(input);
  const checkNames = result.signals.map((s) => s.check);

  for (const expected of expectedChecks) {
    assert.ok(checkNames.includes(expected), `expected check "${expected}" in signals`);
  }
});

test("quality/signals: empty body skips non-critical checks (no false signals)", () => {
  // When body is empty, paywall/link/boilerplate checks don't run
  const input = makeInput({ content: "", wordCount: 0 });
  const result = checkContentQuality(input);

  assert.equal(result.grade, "reject");
  // Checks that depend on non-empty body should not be present
  const skippedChecks = ["paywall-marker", "encoding-garbage", "link-density", "boilerplate-heavy"];
  const presentChecks = result.signals.map((s) => s.check);
  for (const skipped of skippedChecks) {
    assert.ok(!presentChecks.includes(skipped), `check "${skipped}" should be absent for empty body`);
  }
});
