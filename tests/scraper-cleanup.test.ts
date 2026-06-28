/**
 * Tests for provider-level pre-extraction cleanup (Epic #366 / Issue #367).
 *
 * All tests use local HTML fixtures — no real network or DB is touched.
 * The `applyProviderCleanup` function uses sanitize-html under the hood, so
 * we test both the tag-dropping (`dropSelectors`) and keyword-matching
 * (`dropClassKeywords`) paths.
 */
process.env.LOG_LEVEL = "error";

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GENERIC_PROVIDER_CLEANUP,
  applyProviderCleanup,
  mergeProviderCleanup,
} from "@/lib/scraper/cleanup";

// ---------------------------------------------------------------------------
// dropSelectors: tag-based removal
// ---------------------------------------------------------------------------

test("cleanup: removes <video> blocks with all inner content", () => {
  const html =
    "<p>Main content here.</p>" +
    '<video src="x.mp4" controls><source src="x.mp4" type="video/mp4"/>Fallback text</video>' +
    "<p>More content after video.</p>";
  const result = applyProviderCleanup(html, { dropSelectors: ["video"] });
  assert.doesNotMatch(result, /<video/i, "video tag should be removed");
  assert.doesNotMatch(result, /x\.mp4/, "video src should be removed");
  assert.doesNotMatch(result, /Fallback text/, "video inner content should be removed");
  assert.match(result, /Main content here/);
  assert.match(result, /More content after video/);
});

test("cleanup: removes <iframe> blocks with all inner content", () => {
  const html =
    "<p>Text before iframe.</p>" +
    '<iframe src="https://ads.example.com" width="300">iframe fallback</iframe>' +
    "<p>Text after iframe.</p>";
  const result = applyProviderCleanup(html, { dropSelectors: ["iframe"] });
  assert.doesNotMatch(result, /<iframe/i, "iframe tag should be removed");
  assert.doesNotMatch(result, /ads\.example\.com/, "iframe src should be removed");
  assert.doesNotMatch(result, /iframe fallback/, "iframe inner content should be removed");
  assert.match(result, /Text before iframe/);
  assert.match(result, /Text after iframe/);
});

test("cleanup: removes <aside> blocks with all inner content", () => {
  const html =
    "<p>Article body.</p>" +
    '<aside class="promo"><h3>Promo heading</h3><p>Promo paragraph</p></aside>' +
    "<p>Conclusion.</p>";
  const result = applyProviderCleanup(html, { dropSelectors: ["aside"] });
  assert.doesNotMatch(result, /<aside/i);
  assert.doesNotMatch(result, /Promo heading/);
  assert.doesNotMatch(result, /Promo paragraph/);
  assert.match(result, /Article body/);
  assert.match(result, /Conclusion/);
});

test("cleanup: removes multiple different tag types in one pass", () => {
  const html =
    "<p>Content.</p>" +
    '<video src="v.mp4"></video>' +
    '<iframe src="i.html"></iframe>' +
    '<aside class="sidebar">Sidebar</aside>' +
    "<p>End.</p>";
  const result = applyProviderCleanup(html, { dropSelectors: ["video", "iframe", "aside"] });
  assert.doesNotMatch(result, /<video/i);
  assert.doesNotMatch(result, /<iframe/i);
  assert.doesNotMatch(result, /<aside/i);
  assert.doesNotMatch(result, /Sidebar/);
  assert.match(result, /Content/);
  assert.match(result, /End/);
});

// ---------------------------------------------------------------------------
// dropClassKeywords: class/id keyword-based removal
// ---------------------------------------------------------------------------

test("cleanup: removes newsletter block matched by class keyword", () => {
  const html =
    "<p>Article text.</p>" +
    '<div class="newsletter-signup"><h3>Subscribe!</h3><form><input/><button>Join</button></form></div>' +
    "<p>Conclusion.</p>";
  const result = applyProviderCleanup(html, { dropClassKeywords: ["newsletter"] });
  assert.doesNotMatch(result, /Subscribe!/, "newsletter heading should be removed");
  assert.doesNotMatch(result, /newsletter/i, "newsletter class should be removed");
  assert.match(result, /Article text/);
  assert.match(result, /Conclusion/);
});

test("cleanup: removes related-articles block matched by class keyword", () => {
  const html =
    "<p>Intro paragraph.</p>" +
    '<section class="related-articles"><h2>See also</h2><a href="/other">Other story</a></section>' +
    "<p>Main body paragraph.</p>";
  const result = applyProviderCleanup(html, { dropClassKeywords: ["related"] });
  assert.doesNotMatch(result, /See also/);
  assert.doesNotMatch(result, /Other story/);
  assert.match(result, /Intro paragraph/);
  assert.match(result, /Main body paragraph/);
});

test("cleanup: removes social-share block matched by class keyword", () => {
  const html =
    "<p>Content here.</p>" +
    '<div class="social-share"><a>Share on Twitter</a><a>Share on Facebook</a></div>' +
    "<p>Ending here.</p>";
  const result = applyProviderCleanup(html, { dropClassKeywords: ["social"] });
  assert.doesNotMatch(result, /Share on Twitter/);
  assert.doesNotMatch(result, /Share on Facebook/);
  assert.match(result, /Content here/);
  assert.match(result, /Ending here/);
});

test("cleanup: removes promo block matched by class keyword", () => {
  const html =
    "<p>Article content.</p>" +
    '<div class="promo-banner"><p>Special offer — buy now!</p></div>' +
    "<p>More content.</p>";
  const result = applyProviderCleanup(html, { dropClassKeywords: ["promo"] });
  assert.doesNotMatch(result, /Special offer/);
  assert.doesNotMatch(result, /buy now/);
  assert.match(result, /Article content/);
  assert.match(result, /More content/);
});

test("cleanup: removes advertisement block matched by id keyword", () => {
  const html =
    "<p>Text before ad.</p>" +
    '<div id="ad-container"><p>Advertisement content</p></div>' +
    "<p>Text after ad.</p>";
  const result = applyProviderCleanup(html, { dropClassKeywords: ["ad"] });
  assert.doesNotMatch(result, /Advertisement content/);
  assert.match(result, /Text before ad/);
  assert.match(result, /Text after ad/);
});

test("cleanup: generic rules remove common recirculation/newsletter/share chrome", () => {
  const html =
    "<p>Article text.</p>" +
    '<section data-testid="recirc-related"><h2>More like this</h2><a href="/other">Other story</a></section>' +
    '<div aria-label="share this article"><a>Share on Facebook</a></div>' +
    '<div class="paywall-newsletter"><p>Subscribe to our daily newsletter.</p></div>' +
    '<p>Article ending.</p>';
  const result = applyProviderCleanup(html, GENERIC_PROVIDER_CLEANUP);
  assert.doesNotMatch(result, /Other story/);
  assert.doesNotMatch(result, /Share on Facebook/);
  assert.doesNotMatch(result, /daily newsletter/);
  assert.match(result, /Article text/);
  assert.match(result, /Article ending/);
});

test("cleanup: mergeProviderCleanup combines generic and provider rules once", () => {
  const merged = mergeProviderCleanup(GENERIC_PROVIDER_CLEANUP, {
    dropSelectors: ["iframe"],
    dropClassKeywords: ["newsletter", "site-specific"],
  });
  assert.ok(merged.dropSelectors?.includes("iframe"));
  assert.ok(merged.dropClassKeywords?.includes("newsletter"));
  assert.ok(merged.dropClassKeywords?.includes("site-specific"));
  assert.equal(
    merged.dropClassKeywords?.filter((keyword) => keyword === "newsletter").length,
    1,
  );
});

test("cleanup: removes comment block matched by class keyword", () => {
  const html =
    "<p>Article.</p>" +
    '<section class="comments-section"><h2>Comments</h2><div>User comment text</div></section>' +
    "<p>Footer text.</p>";
  const result = applyProviderCleanup(html, { dropClassKeywords: ["comment"] });
  assert.doesNotMatch(result, /User comment text/);
  assert.doesNotMatch(result, /Comments/);
  assert.match(result, /Article/);
});

test("cleanup: keyword match is case-insensitive", () => {
  const html =
    '<div class="NEWSLETTER-SIGNUP"><p>Subscribe!</p></div>' +
    "<p>Real content.</p>";
  const result = applyProviderCleanup(html, { dropClassKeywords: ["newsletter"] });
  assert.doesNotMatch(result, /Subscribe!/);
  assert.match(result, /Real content/);
});

// ---------------------------------------------------------------------------
// Combined dropSelectors + dropClassKeywords
// ---------------------------------------------------------------------------

test("cleanup: main <p> paragraphs are preserved after combined cleanup", () => {
  const html =
    "<article>" +
    "<p>Paragraph one with important content.</p>" +
    '<aside><p>Aside boilerplate text</p></aside>' +
    "<p>Paragraph two continues the story.</p>" +
    '<div class="related-posts"><a href="/other">Read more stories</a></div>' +
    '<video src="promo.mp4"></video>' +
    "<p>Paragraph three concludes the article.</p>" +
    "</article>";
  const result = applyProviderCleanup(html, {
    dropSelectors: ["aside", "video"],
    dropClassKeywords: ["related"],
  });
  assert.match(result, /Paragraph one/);
  assert.match(result, /Paragraph two/);
  assert.match(result, /Paragraph three/);
  assert.doesNotMatch(result, /Aside boilerplate text/);
  assert.doesNotMatch(result, /Read more stories/);
  assert.doesNotMatch(result, /promo\.mp4/);
});

// ---------------------------------------------------------------------------
// Edge-case / safety guardrails
// ---------------------------------------------------------------------------

test("cleanup: no-op when cleanup config is empty", () => {
  const html = "<p>Content here — should be byte-for-byte unchanged.</p>";
  const result = applyProviderCleanup(html, {});
  assert.equal(result, html);
});

test("cleanup: no-op when both arrays are empty", () => {
  const html = "<p>Content unchanged.</p>";
  const result = applyProviderCleanup(html, { dropSelectors: [], dropClassKeywords: [] });
  assert.equal(result, html);
});

test("cleanup: ignores selector-syntax entries in dropSelectors (only plain tag names accepted)", () => {
  // ".ad" and "#promo" are not plain tag names; they should be silently filtered
  const html = '<div class="ad">Ad block</div><p>Real content</p>';
  const result = applyProviderCleanup(html, { dropSelectors: [".ad", "#promo"] });
  // The div.ad should NOT be removed — only plain tag names work here
  assert.match(result, /Ad block/, "complex selectors must be rejected");
  assert.match(result, /Real content/);
});

test("cleanup: only block container tags are checked for keyword matching (not inline tags)", () => {
  // A <span> with class "related" inside a paragraph should NOT be removed
  const html = '<p>Text with a <span class="related-label">related</span> inline tag.</p>';
  const result = applyProviderCleanup(html, { dropClassKeywords: ["related"] });
  // The <span> is an inline element — should not be stripped
  assert.match(result, /Text with a/, "paragraph text should be preserved");
  assert.match(result, /inline tag/, "inline text should be preserved");
});

test("cleanup: does NOT remove <script type='application/ld+json'> (JSON-LD preserved)", () => {
  // Cleanup must leave <script> elements intact so JSON-LD can be extracted afterwards
  const html =
    '<script type="application/ld+json">{"@type":"NewsArticle","headline":"Test"}</script>' +
    '<div class="newsletter"><p>Subscribe!</p></div>' +
    "<p>Article paragraph.</p>";
  const result = applyProviderCleanup(html, { dropClassKeywords: ["newsletter"] });
  assert.match(result, /NewsArticle/, "JSON-LD script content must survive cleanup");
  assert.doesNotMatch(result, /Subscribe!/);
  assert.match(result, /Article paragraph/);
});
