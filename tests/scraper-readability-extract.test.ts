/**
 * Tests for the linkedom + Readability article extractor module.
 *
 * Uses realistic inline HTML fixtures (full `<html>` documents with nav,
 * header, article, related sidebar and footer) and asserts that Readability
 * isolates the main article, captures the byline, preserves real structure,
 * and that the quality gate / null-safety behave as specified. No network,
 * DB, or DOM globals are touched — linkedom provides its own document.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { extractReadable } from "@/lib/scraper/readability-extract";

const ARTICLE_URL = "https://example.com/news/the-art-of-deep-reading";

/** A realistic full page: chrome around a substantial article. */
const FULL_PAGE_HTML = `<!DOCTYPE html>
<html lang="en">
  <head>
    <title>The Art of Deep Reading</title>
  </head>
  <body>
    <nav><a href="/home">Home</a> NAVIGATION_NOISE_TOKEN</nav>
    <header>SITE_HEADER_NOISE_TOKEN</header>
    <main>
      <article>
        <h1>The Art of Deep Reading</h1>
        <p class="byline">By Eleanor Whitfield</p>
        <p>Deep reading is a deliberate practice that trains sustained focus and
        builds comprehension far beyond surface-level skimming. Unlike passive
        consumption, it engages the reader in active synthesis of ideas across
        long passages of text and across substantial stretches of time.</p>
        <h2>Why deep reading matters</h2>
        <p>Studies in cognitive science show that sustained reading of long-form
        text strengthens neural pathways associated with empathy, critical
        thinking and sustained attention. These benefits remain measurable even
        after short daily sessions of careful and uninterrupted practice.</p>
        <ul>
          <li>First structural point about reading and comprehension habits</li>
          <li>Second structural point about attention and focus over time</li>
        </ul>
        <blockquote>A room without books is like a body without a soul, the
        proverb about reading deeply reminds us again and again.</blockquote>
        <p>Practitioners recommend starting with twenty minutes of uninterrupted
        reading, gradually increasing the duration as focus capacity grows over
        weeks and months. The key principle is consistency over raw intensity.</p>
      </article>
    </main>
    <aside class="related">RELATED_SIDEBAR_NOISE_TOKEN — more stories you might
    enjoy reading right now on our site about all manner of unrelated topics.</aside>
    <footer>FOOTER_NOISE_TOKEN copyright and legal boilerplate text here.</footer>
  </body>
</html>`;

test("extracts title and body from a normal article", () => {
  const result = extractReadable(FULL_PAGE_HTML, ARTICLE_URL);
  assert.ok(result !== null, "expected a non-null article");
  assert.equal(result.title, "The Art of Deep Reading");
  assert.match(result.contentHtml, /Deep reading is a deliberate practice/);
  assert.match(result.textContent, /cognitive science/);
});

test("strips nav, header, related sidebar and footer from contentHtml", () => {
  const result = extractReadable(FULL_PAGE_HTML, ARTICLE_URL);
  assert.ok(result !== null);
  assert.doesNotMatch(result.contentHtml, /NAVIGATION_NOISE_TOKEN/);
  assert.doesNotMatch(result.contentHtml, /SITE_HEADER_NOISE_TOKEN/);
  assert.doesNotMatch(result.contentHtml, /RELATED_SIDEBAR_NOISE_TOKEN/);
  assert.doesNotMatch(result.contentHtml, /FOOTER_NOISE_TOKEN/);
});

test("does not retain Readability's readability-page-1 wrapper", () => {
  const result = extractReadable(FULL_PAGE_HTML, ARTICLE_URL);
  assert.ok(result !== null);
  assert.doesNotMatch(result.contentHtml, /readability-page-1/i);
});

test("captures the byline when the page has an author", () => {
  const result = extractReadable(FULL_PAGE_HTML, ARTICLE_URL);
  assert.ok(result !== null);
  assert.ok(result.byline, "byline should be populated");
  assert.match(result.byline, /Eleanor Whitfield/);
});

test("preserves headings, lists and blockquotes in contentHtml", () => {
  const result = extractReadable(FULL_PAGE_HTML, ARTICLE_URL);
  assert.ok(result !== null);
  assert.match(result.contentHtml, /<h2[^>]*>\s*Why deep reading matters/);
  assert.match(result.contentHtml, /<ul>/);
  assert.match(result.contentHtml, /<li>First structural point/);
  assert.match(result.contentHtml, /<blockquote>/);
  assert.match(result.contentHtml, /<p>/);
});

test("resolves relative links against the source URL via injected base", () => {
  const html = `<!DOCTYPE html><html lang="en"><head><title>Linked Reading Guide</title></head>
    <body><article><h1>Linked Reading Guide</h1>
    <p>Deep reading is a deliberate practice that trains sustained focus and builds
    comprehension far beyond surface-level skimming through active synthesis of ideas
    across long passages of text and across substantial stretches of time itself.</p>
    <p>Studies in cognitive science show sustained reading strengthens neural pathways
    for empathy and critical thinking measurably even after short daily sessions and a
    little patient practice over weeks. See <a href="/more/here">more here now</a>.</p>
    </article></body></html>`;
  const result = extractReadable(html, "https://example.com/news/guide");
  assert.ok(result !== null);
  assert.match(result.contentHtml, /https:\/\/example\.com\/more\/here/);
});

test("computes a reasonable wordCount from text content", () => {
  const result = extractReadable(FULL_PAGE_HTML, ARTICLE_URL);
  assert.ok(result !== null);
  assert.ok(result.wordCount >= 50, `expected >= 50 words, got ${result.wordCount}`);
  const recomputed = result.textContent.split(/\s+/).filter(Boolean).length;
  assert.equal(result.wordCount, recomputed);
});

test("exposes excerpt, lang and other metadata fields", () => {
  const result = extractReadable(FULL_PAGE_HTML, ARTICLE_URL);
  assert.ok(result !== null);
  assert.equal(result.lang, "en");
  assert.ok(result.excerpt && result.excerpt.length > 0, "excerpt should be populated");
});

test("returns null for a body that is too short to be an article", () => {
  const html = `<!DOCTYPE html><html><head><title>Tiny Note</title></head>
    <body><article><h1>Tiny Note</h1><p>Just a few words here.</p></article></body></html>`;
  assert.equal(extractReadable(html, ARTICLE_URL), null);
});

test("returns null when there is no extractable title", () => {
  const html = `<!DOCTYPE html><html><head></head><body><div></div></body></html>`;
  assert.equal(extractReadable(html, ARTICLE_URL), null);
});

test("returns null for empty input", () => {
  assert.equal(extractReadable("", ARTICLE_URL), null);
  assert.equal(extractReadable("   ", ARTICLE_URL), null);
});

test("does not throw on malformed HTML and returns null", () => {
  const malformed = "<html><body><article><p>unclosed tags <<<< &&& <div";
  let result: ReturnType<typeof extractReadable>;
  assert.doesNotThrow(() => {
    result = extractReadable(malformed, ARTICLE_URL);
  });
  assert.equal(result!, null);
});
