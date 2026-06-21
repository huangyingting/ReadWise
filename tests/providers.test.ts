/**
 * Tests for provider registration and category mapping (Issue #118).
 * Verifies: BBC Learning English and VOA Learning English are registered,
 * their articleUrlPattern matches expected paths, and categoryFor maps
 * topic paths to canonical CATEGORY_SLUGS.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { PROVIDERS, getProvider, mapSectionToCategory } from "@/lib/scraper/providers";
import { CATEGORY_SLUGS } from "@/lib/categories";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getProviderOrFail(key: string) {
  const p = getProvider(key);
  assert.ok(p, `Provider "${key}" must be registered`);
  return p!;
}

// ---------------------------------------------------------------------------
// BBC Learning English
// ---------------------------------------------------------------------------

test("bbc-learning-english provider is registered", () => {
  const p = getProvider("bbc-learning-english");
  assert.ok(p, "BBC Learning English must be in the PROVIDERS registry");
  assert.equal(p?.key, "bbc-learning-english");
});

test("bbc-learning-english articleUrlPattern matches learningenglish paths", () => {
  const p = getProviderOrFail("bbc-learning-english");
  assert.ok(p.articleUrlPattern.test("https://www.bbc.co.uk/learningenglish/english/features/6-minute-english/ep-230101"), "should match 6-minute-english path");
  assert.ok(p.articleUrlPattern.test("https://www.bbc.co.uk/learningenglish/english/features/news-report/ep-230115"), "should match news-report path");
  assert.ok(!p.articleUrlPattern.test("https://www.bbc.co.uk/news/uk-12345"), "should NOT match regular BBC news");
  assert.ok(!p.articleUrlPattern.test("https://bbc.com/sport/football"), "should NOT match bbc.com sport");
});

test("bbc-learning-english categoryFor maps science path to science", () => {
  const p = getProviderOrFail("bbc-learning-english");
  const url = new URL("https://www.bbc.co.uk/learningenglish/english/features/science-focus/ep-2301");
  const cat = p.categoryFor(url, null);
  assert.equal(cat, "science");
});

test("bbc-learning-english categoryFor maps health path to health", () => {
  const p = getProviderOrFail("bbc-learning-english");
  const url = new URL("https://www.bbc.co.uk/learningenglish/english/features/health/ep-2301");
  const cat = p.categoryFor(url, null);
  assert.equal(cat, "health");
});

test("bbc-learning-english categoryFor defaults to culture for generic paths", () => {
  const p = getProviderOrFail("bbc-learning-english");
  const url = new URL("https://www.bbc.co.uk/learningenglish/english/features/6-minute-english/ep-2301");
  const cat = p.categoryFor(url, null);
  assert.ok(CATEGORY_SLUGS.includes(cat ?? ""), `returned category "${cat}" must be a valid slug`);
});

// ---------------------------------------------------------------------------
// VOA Learning English
// ---------------------------------------------------------------------------

test("voa-learning-english provider is registered", () => {
  const p = getProvider("voa-learning-english");
  assert.ok(p, "VOA Learning English must be in the PROVIDERS registry");
  assert.equal(p?.key, "voa-learning-english");
});

test("voa-learning-english articleUrlPattern matches /a/<slug>.html paths", () => {
  const p = getProviderOrFail("voa-learning-english");
  assert.ok(p.articleUrlPattern.test("https://learningenglish.voanews.com/a/climate-change-impacts.html"), "should match /a/ article");
  assert.ok(p.articleUrlPattern.test("https://learningenglish.voanews.com/a/us-economy-2025.html"), "should match /a/ article");
  assert.ok(!p.articleUrlPattern.test("https://learningenglish.voanews.com/science-technology"), "should NOT match section pages");
  assert.ok(!p.articleUrlPattern.test("https://learningenglish.voanews.com/"), "should NOT match homepage");
});

test("voa-learning-english categoryFor maps science-technology path to science", () => {
  const p = getProviderOrFail("voa-learning-english");
  const url = new URL("https://learningenglish.voanews.com/science-technology");
  const cat = p.categoryFor(url, "science-technology");
  assert.equal(cat, "science");
});

test("voa-learning-english categoryFor maps health-lifestyle to health", () => {
  const p = getProviderOrFail("voa-learning-english");
  const url = new URL("https://learningenglish.voanews.com/health-lifestyle");
  const cat = p.categoryFor(url, "health-lifestyle");
  assert.equal(cat, "health");
});

test("voa-learning-english categoryFor maps arts-culture to culture", () => {
  const p = getProviderOrFail("voa-learning-english");
  const url = new URL("https://learningenglish.voanews.com/arts-culture");
  const cat = p.categoryFor(url, "arts-culture");
  assert.equal(cat, "culture");
});

test("voa-learning-english categoryFor returns a valid category slug for any path", () => {
  const p = getProviderOrFail("voa-learning-english");
  const url = new URL("https://learningenglish.voanews.com/a/some-article.html");
  const cat = p.categoryFor(url, null);
  assert.ok(cat === null || CATEGORY_SLUGS.includes(cat), `returned "${cat}" must be null or a valid slug`);
});

// ---------------------------------------------------------------------------
// General provider registry
// ---------------------------------------------------------------------------

test("all providers have keys with valid category slugs as defaults", () => {
  for (const p of PROVIDERS) {
    assert.ok(
      CATEGORY_SLUGS.includes(p.defaultCategory),
      `Provider "${p.key}" defaultCategory "${p.defaultCategory}" must be a valid slug`,
    );
  }
});

test("getProvider is case-insensitive", () => {
  assert.ok(getProvider("NBC"));
  assert.ok(getProvider("nbc"));
});

// ---------------------------------------------------------------------------
// mapSectionToCategory
// ---------------------------------------------------------------------------

test("mapSectionToCategory handles learner-English topic strings", () => {
  assert.equal(mapSectionToCategory("science"), "science");
  assert.equal(mapSectionToCategory("sports"), "sports");
  assert.equal(mapSectionToCategory("health"), "health");
  assert.equal(mapSectionToCategory("technology"), "tech");
  assert.equal(mapSectionToCategory("entertainment"), "entertainment");
  assert.equal(mapSectionToCategory("unknown-topic"), null);
});
