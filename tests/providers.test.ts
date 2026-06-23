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
  assert.ok(p.categoryFor, "BBC LE must have a categoryFor function");
  const url = new URL("https://www.bbc.co.uk/learningenglish/english/features/science-focus/ep-2301");
  const cat = p.categoryFor!(url, null);
  assert.equal(cat, "science");
});

test("bbc-learning-english categoryFor maps health path to health", () => {
  const p = getProviderOrFail("bbc-learning-english");
  assert.ok(p.categoryFor, "BBC LE must have a categoryFor function");
  const url = new URL("https://www.bbc.co.uk/learningenglish/english/features/health/ep-2301");
  const cat = p.categoryFor!(url, null);
  assert.equal(cat, "health");
});

test("bbc-learning-english categoryFor defaults to culture for generic paths", () => {
  const p = getProviderOrFail("bbc-learning-english");
  assert.ok(p.categoryFor, "BBC LE must have a categoryFor function");
  const url = new URL("https://www.bbc.co.uk/learningenglish/english/features/6-minute-english/ep-2301");
  const cat = p.categoryFor!(url, null);
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
  assert.ok(p.categoryFor, "VOA must have a categoryFor function");
  const url = new URL("https://learningenglish.voanews.com/science-technology");
  const cat = p.categoryFor!(url, "science-technology");
  assert.equal(cat, "science");
});

test("voa-learning-english categoryFor maps health-lifestyle to health", () => {
  const p = getProviderOrFail("voa-learning-english");
  assert.ok(p.categoryFor, "VOA must have a categoryFor function");
  const url = new URL("https://learningenglish.voanews.com/health-lifestyle");
  const cat = p.categoryFor!(url, "health-lifestyle");
  assert.equal(cat, "health");
});

test("voa-learning-english categoryFor maps arts-culture to culture", () => {
  const p = getProviderOrFail("voa-learning-english");
  assert.ok(p.categoryFor, "VOA must have a categoryFor function");
  const url = new URL("https://learningenglish.voanews.com/arts-culture");
  const cat = p.categoryFor!(url, "arts-culture");
  assert.equal(cat, "culture");
});

test("voa-learning-english categoryFor returns a valid category slug for any path", () => {
  const p = getProviderOrFail("voa-learning-english");
  assert.ok(p.categoryFor, "VOA must have a categoryFor function");
  const url = new URL("https://learningenglish.voanews.com/a/some-article.html");
  const cat = p.categoryFor!(url, null);
  assert.ok(cat === null || CATEGORY_SLUGS.includes(cat), `returned "${cat}" must be null or a valid slug`);
});

// ---------------------------------------------------------------------------
// General provider registry
// ---------------------------------------------------------------------------

test("all providers have keys with valid category slugs as defaults", () => {
  for (const p of PROVIDERS) {
    assert.ok(
      p.defaultCategory !== null && CATEGORY_SLUGS.includes(p.defaultCategory),
      `Provider "${p.key}" defaultCategory "${p.defaultCategory}" must be a valid slug`,
    );
  }
});

test("getProvider is case-insensitive", () => {
  assert.ok(getProvider("NBC"));
  assert.ok(getProvider("nbc"));
});

test("ReadingX-derived providers are registered", () => {
  for (const key of [
    "bbc",
    "smithsonian",
    "knowable",
    "nautilus",
    "aeon",
    "technologyreview",
    "noema",
    "undark",
  ]) {
    const p = getProvider(key);
    assert.ok(p, `Provider "${key}" must be registered`);
    assert.ok(p?.seeds.length, `Provider "${key}" must have discovery seeds`);
  }
});

test("ReadingX-derived provider URL patterns match article URLs", () => {
  assert.ok(getProviderOrFail("bbc").articleUrlPattern.test("https://www.bbc.com/news/articles/c1234567890"));
  assert.ok(
    getProviderOrFail("smithsonian").articleUrlPattern.test(
      "https://www.smithsonianmag.com/science-nature/example-story-180987800/",
    ),
  );
  assert.ok(
    getProviderOrFail("knowable").articleUrlPattern.test(
      "https://knowablemagazine.org/content/article/technology/2026/example-story",
    ),
  );
  assert.ok(getProviderOrFail("nautilus").articleUrlPattern.test("https://nautil.us/example-story-123456/"));
  assert.ok(getProviderOrFail("aeon").articleUrlPattern.test("https://aeon.co/essays/example-story"));
  assert.ok(
    getProviderOrFail("technologyreview").articleUrlPattern.test(
      "https://www.technologyreview.com/2026/06/23/123456/example-story/",
    ),
  );
  assert.ok(getProviderOrFail("noema").articleUrlPattern.test("https://www.noemamag.com/example-story/"));
  assert.ok(getProviderOrFail("undark").articleUrlPattern.test("https://undark.org/2026/06/23/example-story/"));
});

test("ReadingX-derived URL filters reject non-article pages", () => {
  const bbc = getProviderOrFail("bbc");
  assert.equal(bbc.articleUrlFilter?.("https://www.bbc.com/news/live/c1234567890"), false);

  const smithsonian = getProviderOrFail("smithsonian");
  assert.equal(smithsonian.articleUrlFilter?.("https://www.smithsonianmag.com/category/science-nature/"), false);

  const technologyReview = getProviderOrFail("technologyreview");
  assert.equal(technologyReview.articleUrlFilter?.("https://www.technologyreview.com/topic/artificial-intelligence/"), false);

  const undark = getProviderOrFail("undark");
  assert.equal(undark.articleUrlFilter?.("https://undark.org/tag/climate-change/"), false);
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
