/**
 * Unit tests for src/lib/scraper/providers/noema.ts.
 *
 * The noema provider is a pure data/config object (no async I/O, no DB deps).
 * No mocks are required — the module is imported directly.
 *
 * Coverage targets:
 *   - key, name, hostnames, defaultCategory, seeds
 *   - articleUrlPattern: matches article slugs, rejects section/index pages
 *   - articleUrlFilter: excludes topic/type/author/tag/navigation paths
 *   - categoryFor: all five category rules + fallback
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import noema from "@/lib/scraper/providers/noema";

// ── Identity ─────────────────────────────────────────────────────────────────

test("noema provider key is 'noema' and name is 'Noema Magazine'", () => {
  assert.equal(noema.key, "noema");
  assert.equal(noema.name, "Noema Magazine");
});

test("noema defaultCategory is 'culture'", () => {
  assert.equal(noema.defaultCategory, "culture");
});

// ── Hostnames ─────────────────────────────────────────────────────────────────

test("noema hostnames include both noemamag.com and www.noemamag.com", () => {
  assert.ok(noema.hostnames.includes("noemamag.com"), "should include bare domain");
  assert.ok(noema.hostnames.includes("www.noemamag.com"), "should include www subdomain");
  assert.equal(noema.hostnames.length, 2);
});

// ── Seeds ────────────────────────────────────────────────────────────────────

test("noema seeds all start with https://www.noemamag.com/article-topic/", () => {
  assert.ok(noema.seeds.length >= 5, "expected at least 5 topic seeds");
  for (const seed of noema.seeds) {
    assert.ok(
      seed.startsWith("https://www.noemamag.com/article-topic/"),
      `unexpected seed: ${seed}`,
    );
  }
});

// ── articleUrlPattern ────────────────────────────────────────────────────────

test("noema articleUrlPattern matches plain article slug on www subdomain", () => {
  assert.ok(noema.articleUrlPattern.test("https://www.noemamag.com/the-philosophy-of-networks"));
});

test("noema articleUrlPattern matches plain article slug on bare domain", () => {
  assert.ok(noema.articleUrlPattern.test("https://noemamag.com/climate-and-society"));
});

test("noema articleUrlPattern matches slug with trailing slash", () => {
  assert.ok(noema.articleUrlPattern.test("https://www.noemamag.com/my-article-2024/"));
});

test("noema articleUrlPattern matches slug with query string", () => {
  assert.ok(noema.articleUrlPattern.test("https://www.noemamag.com/story-123?ref=home"));
});

test("noema articleUrlPattern matches alphanumeric slug", () => {
  assert.ok(noema.articleUrlPattern.test("https://www.noemamag.com/article123"));
});

test("noema articleUrlPattern rejects nested paths (subdirectory)", () => {
  assert.ok(!noema.articleUrlPattern.test("https://www.noemamag.com/nested/path/article"));
});

test("noema articleUrlPattern rejects article-topic index pages", () => {
  assert.ok(!noema.articleUrlPattern.test("https://www.noemamag.com/article-topic/technology/"));
});

test("noema articleUrlPattern rejects article-type index pages", () => {
  assert.ok(!noema.articleUrlPattern.test("https://www.noemamag.com/article-type/essay/"));
});

test("noema articleUrlPattern rejects URLs from a different domain", () => {
  assert.ok(!noema.articleUrlPattern.test("https://www.othermag.com/article"));
});

// ── articleUrlFilter ─────────────────────────────────────────────────────────

test("noema articleUrlFilter excludes /article-topic/ paths", () => {
  assert.equal(
    noema.articleUrlFilter!("https://www.noemamag.com/article-topic/tech/"),
    false,
  );
});

test("noema articleUrlFilter excludes /article-type/ paths", () => {
  assert.equal(
    noema.articleUrlFilter!("https://www.noemamag.com/article-type/essay/"),
    false,
  );
});

test("noema articleUrlFilter excludes /author/ paths", () => {
  assert.equal(
    noema.articleUrlFilter!("https://www.noemamag.com/author/ada-lovelace"),
    false,
  );
});

test("noema articleUrlFilter excludes /tag/ paths", () => {
  assert.equal(noema.articleUrlFilter!("https://www.noemamag.com/tag/philosophy"), false);
});

test("noema articleUrlFilter excludes /about paths", () => {
  assert.equal(noema.articleUrlFilter!("https://www.noemamag.com/about"), false);
});

test("noema articleUrlFilter excludes /contact paths", () => {
  assert.equal(noema.articleUrlFilter!("https://www.noemamag.com/contact"), false);
});

test("noema articleUrlFilter excludes /newsletter paths", () => {
  assert.equal(noema.articleUrlFilter!("https://www.noemamag.com/newsletter"), false);
});

test("noema articleUrlFilter excludes /masthead paths", () => {
  assert.equal(noema.articleUrlFilter!("https://www.noemamag.com/masthead"), false);
});

test("noema articleUrlFilter excludes /careers paths", () => {
  assert.equal(noema.articleUrlFilter!("https://www.noemamag.com/careers"), false);
});

test("noema articleUrlFilter excludes /feed paths", () => {
  assert.equal(noema.articleUrlFilter!("https://www.noemamag.com/feed/"), false);
});

test("noema articleUrlFilter excludes /wp- paths (WordPress internals)", () => {
  assert.equal(
    noema.articleUrlFilter!("https://www.noemamag.com/wp-content/uploads/img.jpg"),
    false,
  );
});

test("noema articleUrlFilter excludes /articles-search paths", () => {
  assert.equal(
    noema.articleUrlFilter!("https://www.noemamag.com/articles-search"),
    false,
  );
});

test("noema articleUrlFilter accepts a valid article slug", () => {
  assert.equal(
    noema.articleUrlFilter!("https://www.noemamag.com/the-philosophy-of-networks"),
    true,
  );
});

test("noema articleUrlFilter accepts a valid article slug on bare domain", () => {
  assert.equal(
    noema.articleUrlFilter!("https://noemamag.com/future-of-democracy"),
    true,
  );
});

// ── categoryFor ──────────────────────────────────────────────────────────────

test("noema categoryFor maps 'technology' in pathname to 'tech'", () => {
  const url = new URL("https://www.noemamag.com/article-topic/technology-and-the-human/");
  assert.equal(noema.categoryFor!(url, null), "tech");
});

test("noema categoryFor maps 'digital' in pathname to 'tech'", () => {
  const url = new URL("https://www.noemamag.com/article-topic/digital-society/");
  assert.equal(noema.categoryFor!(url, null), "tech");
});

test("noema categoryFor maps 'capitalism' in section metadata to 'business'", () => {
  const url = new URL("https://www.noemamag.com/some-article");
  assert.equal(noema.categoryFor!(url, "future-of-capitalism"), "business");
});

test("noema categoryFor maps 'climate' in pathname to 'science'", () => {
  const url = new URL("https://www.noemamag.com/article-topic/climate-crisis/");
  assert.equal(noema.categoryFor!(url, null), "science");
});

test("noema categoryFor maps 'geopolitics' in section metadata to 'politics'", () => {
  const url = new URL("https://www.noemamag.com/some-article");
  assert.equal(noema.categoryFor!(url, "geopolitics-globalization"), "politics");
});

test("noema categoryFor maps 'democracy' in pathname to 'politics'", () => {
  const url = new URL("https://www.noemamag.com/article-topic/future-of-democracy/");
  assert.equal(noema.categoryFor!(url, null), "politics");
});

test("noema categoryFor maps 'philosophy' in pathname to 'culture'", () => {
  const url = new URL("https://www.noemamag.com/article-topic/philosophy-culture/");
  assert.equal(noema.categoryFor!(url, null), "culture");
});

test("noema categoryFor falls back to 'culture' for an unrecognized slug", () => {
  const url = new URL("https://www.noemamag.com/random-unknown-article");
  assert.equal(noema.categoryFor!(url, null), "culture");
});

test("noema categoryFor prefers section metadata over URL pathname for category mapping", () => {
  // Pathname has no recognizable keyword; section says "capitalism" → business.
  const url = new URL("https://www.noemamag.com/generic-slug");
  assert.equal(noema.categoryFor!(url, "capitalism"), "business");
});
