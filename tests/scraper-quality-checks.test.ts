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

/**
 * Pool of genuine English sentences used to build realistic article prose for
 * "good article" fixtures. Real prose (proper stopwords, sentence structure,
 * English) is required so the language / stopword / sentence heuristics added
 * in Issue #739 do not (correctly) flag synthetic `words()` streams as junk.
 */
const PROSE_SENTENCES = [
  "The city council voted on Tuesday to approve a new plan for the downtown district.",
  "Researchers at the university have studied the effects of the change for several years.",
  "According to the report, the number of visitors has grown steadily since last spring.",
  "Many residents say they are happy with the improvements that were made to the park.",
  "Officials noted that the project would not have been possible without local support.",
  "The author explains how the small team managed to finish the work ahead of schedule.",
  "In the morning, people gather near the station to wait for the first train of the day.",
  "She argued that the best solution would be to invest in better public transportation.",
  "The new exhibit traces the history of the press and how books changed the way we read.",
  "Economists warned that rising rates could slow the market, but they pointed to job growth.",
  "When the storm finally passed, volunteers spent the weekend clearing debris from the streets.",
  "Doctors have noticed that patients who walk each day tend to recover more quickly after surgery.",
  "The committee spent several hours debating whether the historic theater should be restored.",
  "Astronomers believe the faint signal came from a distant galaxy beyond our own.",
  "After the election, the mayor promised to focus on schools and smaller class sizes for children.",
  "Engineers tested the bridge for weeks, slowly increasing the load until they were confident.",
];

/** Builds realistic English article prose of at least `minWords` words. */
function prose(minWords: number): string {
  const out: string[] = [];
  let count = 0;
  let i = 0;
  while (count < minWords) {
    const sentence = PROSE_SENTENCES[i % PROSE_SENTENCES.length]!;
    out.push(sentence);
    count += sentence.split(/\s+/).length;
    i++;
  }
  return out.join(" ");
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
    content: articleHtml(prose(200)),
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
    content: articleHtml(prose(300)),
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
  const input = makeInput({ content: articleHtml(prose(MIN_WORD_COUNT)), wordCount: MIN_WORD_COUNT });
  const result = checkContentQuality(input);

  assert.equal(signalFor(result, "word-count")?.passed, true);
  assert.notEqual(result.grade, "reject");
});

test(`quality/ok: article with ${SHORT_WORD_COUNT} words passes word-count (no reject)`, () => {
  const input = makeInput({
    content: articleHtml(prose(SHORT_WORD_COUNT)),
    wordCount: SHORT_WORD_COUNT,
  });
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
  // ~100 words of real prose ≈ 600 chars; 30 U+FFFD ≈ 4.7% > 2%.
  const baseProse = prose(100);
  const garbage = "\uFFFD".repeat(30);
  const body = `${baseProse} ${garbage}`;
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
    content: articleHtml(prose(200)),
    author: null,
    publishedAt: new Date("2026-01-01T00:00:00Z"),
  });
  const result = checkContentQuality(input);

  assert.equal(result.grade, "ok");
  assert.equal(signalFor(result, "missing-author")?.passed, false);
});

test("quality/ok: missing date alone does not produce a warn grade", () => {
  const input = makeInput({
    content: articleHtml(prose(200)),
    author: "Some Author",
    publishedAt: null,
  });
  const result = checkContentQuality(input);

  assert.equal(result.grade, "ok");
  assert.equal(signalFor(result, "missing-date")?.passed, false);
});

test("quality/ok: missing both author and date does not produce a warn grade", () => {
  const input = makeInput({
    content: articleHtml(prose(200)),
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

// ---------------------------------------------------------------------------
// 12. Enhanced heuristics (Issue #739): language, stopwords, ad-copy,
//     sentence structure, shouting, repetition
// ---------------------------------------------------------------------------

/** Spanish promo prose (long enough for reliable language detection). */
const SPANISH_BODY =
  "Hola estimados clientes, esta es una oferta especial por tiempo limitado para todos " +
  "nuestros productos de la tienda. Compra ahora y ahorra mucho dinero en cada pedido que " +
  "realices durante esta semana. Los precios mas bajos del ano estan disponibles para " +
  "nuestros miembros, asi que no esperes mas y aprovecha esta gran promocion increible hoy.";

test("quality/reject: non-English body is flagged and rejected (franc)", () => {
  const input = makeInput({ content: articleHtml(SPANISH_BODY), wordCount: 60 });
  const result = checkContentQuality(input);

  assert.equal(signalFor(result, "non-english")?.passed, false);
  assert.equal(result.grade, "reject");
  assert.match(signalFor(result, "non-english")?.detail ?? "", /lang=/);
});

test("quality/ok: clean English article passes the non-english language check", () => {
  const input = makeInput({ content: articleHtml(prose(200)) });
  const result = checkContentQuality(input);

  assert.equal(signalFor(result, "non-english")?.passed, true);
});

test("quality/ok: short non-English snippet does NOT false-positive (und passes)", () => {
  // Too short for reliable detection — the language gate is skipped, so the
  // non-english signal must pass even though the snippet is not English.
  const input = makeInput({ content: articleHtml("Bonjour le monde, ça va bien"), wordCount: 60 });
  const result = checkContentQuality(input);

  assert.equal(signalFor(result, "non-english")?.passed, true);
  assert.match(signalFor(result, "non-english")?.detail ?? "", /skipped/);
});

test("quality/warn: keyword-stuffing with very low stopword ratio triggers low-stopword-ratio", () => {
  const stuffed = Array.from(
    { length: 60 },
    (_, i) => ["shoes", "boots", "sneakers", "running", "cheap", "footwear"][i % 6],
  ).join(" ");
  const input = makeInput({ content: articleHtml(stuffed), wordCount: 60 });
  const result = checkContentQuality(input);

  assert.equal(signalFor(result, "low-stopword-ratio")?.passed, false);
  assert.notEqual(result.grade, "ok");
  assert.match(signalFor(result, "low-stopword-ratio")?.detail ?? "", /stopwordRatio=/);
});

test("quality/ok: real prose has a healthy stopword ratio", () => {
  const input = makeInput({ content: articleHtml(prose(200)) });
  const result = checkContentQuality(input);

  assert.equal(signalFor(result, "low-stopword-ratio")?.passed, true);
});

test("quality/warn: dense ad / call-to-action copy triggers ad-copy", () => {
  const ad =
    "Subscribe now and save fifty percent off your first order today. Buy now and shop now " +
    "for the best deals. Click here to claim your coupon. Limited time sale, sign up today, " +
    "free shipping on every order, order now before this deal ends tonight for just $9 each.";
  const input = makeInput({ content: articleHtml(ad), wordCount: 55 });
  const result = checkContentQuality(input);

  assert.equal(signalFor(result, "ad-copy")?.passed, false);
  assert.notEqual(result.grade, "ok");
  assert.match(signalFor(result, "ad-copy")?.detail ?? "", /adDensity=/);
});

test("quality/ok: an article mentioning a price once does not trip ad-copy", () => {
  const body = prose(200) + " The ticket costs about $5 for most visitors.";
  const input = makeInput({ content: articleHtml(body) });
  const result = checkContentQuality(input);

  assert.equal(signalFor(result, "ad-copy")?.passed, true);
});

test("quality/warn: fragment / nav-list body triggers weak-sentence-structure", () => {
  const fragments =
    "Home. About. Contact. News. Sports. Weather. Login. Menu. Search. More. Help. Terms. " +
    "Privacy. Jobs. Press. Blog. Photos. Maps. Shop. Cart. Account. Top. Back. Next. Email. " +
    "Print. Save. Share. Follow. Like. Tweet. Pin. Tags. Popular. Latest. Trending. Video. " +
    "Audio. Live. Local. World. Money. Tech. Style. Food. Travel. Health.";
  const input = makeInput({ content: articleHtml(fragments), wordCount: 46 });
  const result = checkContentQuality(input);

  assert.equal(signalFor(result, "weak-sentence-structure")?.passed, false);
  assert.match(signalFor(result, "weak-sentence-structure")?.detail ?? "", /sentences=\d+/);
});

test("quality/ok: well-formed prose passes weak-sentence-structure", () => {
  const input = makeInput({ content: articleHtml(prose(200)) });
  const result = checkContentQuality(input);

  assert.equal(signalFor(result, "weak-sentence-structure")?.passed, true);
});

test("quality/advisory: all-caps shouting fires the advisory shouting signal", () => {
  const shout = prose(200) + " ACT NOW BUY TODAY HUGE EVENT MASSIVE OFFER FINAL HOURS HURRY";
  const input = makeInput({ content: articleHtml(shout) });
  const result = checkContentQuality(input);

  // Shouting is advisory: it should fire but not by itself reject a real article.
  const shouting = signalFor(result, "shouting");
  assert.ok(shouting, "shouting signal should be present");
});

test("quality/warn: repeated 3-gram (ad repeating a CTA) triggers repetitive", () => {
  const repeated = "best deal ever today ".repeat(20).trim();
  const input = makeInput({ content: articleHtml(repeated), wordCount: 80 });
  const result = checkContentQuality(input);

  assert.equal(signalFor(result, "repetitive")?.passed, false);
  assert.match(signalFor(result, "repetitive")?.detail ?? "", /maxTrigram=\d+/);
});

test("quality/ok: varied prose is not flagged as repetitive", () => {
  const input = makeInput({ content: articleHtml(prose(300)) });
  const result = checkContentQuality(input);

  assert.equal(signalFor(result, "repetitive")?.passed, true);
});

// ---------------------------------------------------------------------------
// 13. Naive-Bayes classifier integration (env-gated, conservative)
// ---------------------------------------------------------------------------

const AD_LIKE_BODY =
  "Subscribe now and unlock exclusive members-only deals delivered to your inbox every single " +
  "week of the year. Sign up today, claim your personal coupon code, and start saving money on " +
  "every order you place with us. Buy now and shop now for the very best prices anywhere online. " +
  "Click here to redeem your reward, enjoy free shipping on everything, and never miss another " +
  "limited time offer from our store again because these incredible savings will not last long.";

test("quality/ml: classifier flags ad-like body with ml-ad-classifier when enabled", () => {
  const prev = process.env.SCRAPER_QUALITY_CLASSIFIER;
  delete process.env.SCRAPER_QUALITY_CLASSIFIER; // default ON
  try {
    const input = makeInput({ content: articleHtml(AD_LIKE_BODY), wordCount: 80 });
    const result = checkContentQuality(input);
    assert.equal(signalFor(result, "ml-ad-classifier")?.passed, false);
    assert.notEqual(result.grade, "ok");
  } finally {
    if (prev === undefined) delete process.env.SCRAPER_QUALITY_CLASSIFIER;
    else process.env.SCRAPER_QUALITY_CLASSIFIER = prev;
  }
});

test("quality/ml: classifier signal is absent when SCRAPER_QUALITY_CLASSIFIER=false", () => {
  const prev = process.env.SCRAPER_QUALITY_CLASSIFIER;
  process.env.SCRAPER_QUALITY_CLASSIFIER = "false";
  try {
    const input = makeInput({ content: articleHtml(AD_LIKE_BODY), wordCount: 80 });
    const result = checkContentQuality(input);
    assert.equal(signalFor(result, "ml-ad-classifier"), undefined);
  } finally {
    if (prev === undefined) delete process.env.SCRAPER_QUALITY_CLASSIFIER;
    else process.env.SCRAPER_QUALITY_CLASSIFIER = prev;
  }
});

test("quality/ml: a clean long article is not down-ranked by the classifier", () => {
  const prev = process.env.SCRAPER_QUALITY_CLASSIFIER;
  delete process.env.SCRAPER_QUALITY_CLASSIFIER; // default ON
  try {
    const input = makeInput({
      content: articleHtml(prose(300)),
      author: "Jane Doe",
      publishedAt: new Date("2026-05-01T10:00:00Z"),
    });
    const result = checkContentQuality(input);
    // Conservative guard: clean, long article is skipped entirely → ok / 100.
    assert.equal(result.grade, "ok");
    assert.equal(signalFor(result, "ml-ad-classifier"), undefined);
  } finally {
    if (prev === undefined) delete process.env.SCRAPER_QUALITY_CLASSIFIER;
    else process.env.SCRAPER_QUALITY_CLASSIFIER = prev;
  }
});
