/**
 * Tests for the optional HTML normalization pass (Epic #366 / Issue #368).
 *
 * All tests use inline HTML strings — no real network or DB.
 * The `normalizeArticleHtml` function is disabled by default; tests use
 * `{ force: true }` to enable it without setting the process env var.
 */
process.env.LOG_LEVEL = "error";

import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeArticleHtml } from "@/lib/scraper/normalize";

// ---------------------------------------------------------------------------
// Default-off behaviour
// ---------------------------------------------------------------------------

test("normalize: disabled by default — html field is the original string", () => {
  const html = "<p>Hello</p><script>alert(1)</script>";
  const result = normalizeArticleHtml(html);
  assert.strictEqual(result.html, html, "should return original string reference unchanged");
});

test("normalize: disabled — compressionRatio is exactly 1", () => {
  const html = "<p>Content</p><script>x</script>";
  const { compressionRatio } = normalizeArticleHtml(html);
  assert.equal(compressionRatio, 1);
});

test("normalize: disabled — originalLength equals normalizedLength", () => {
  const html = "<p>Content</p><script>x</script>";
  const { originalLength, normalizedLength } = normalizeArticleHtml(html);
  assert.equal(originalLength, normalizedLength);
});

test("normalize: enabled via SCRAPER_HTML_NORMALIZE env var", () => {
  const original = process.env.SCRAPER_HTML_NORMALIZE;
  try {
    process.env.SCRAPER_HTML_NORMALIZE = "true";
    const html = "<p>Content</p><script>window.x=1</script>";
    const { html: out } = normalizeArticleHtml(html);
    assert.doesNotMatch(out, /<script/i, "scripts should be stripped when env var is set");
  } finally {
    // Restore original value so other tests aren't affected.
    if (original === undefined) {
      delete process.env.SCRAPER_HTML_NORMALIZE;
    } else {
      process.env.SCRAPER_HTML_NORMALIZE = original;
    }
  }
});

// ---------------------------------------------------------------------------
// Noise removal (enabled via force:true)
// ---------------------------------------------------------------------------

test("normalize: strips <script> tags and their content", () => {
  const html = "<p>Keep this.</p><script>window.__analytics = {}; doTrack();</script><p>And this.</p>";
  const { html: out } = normalizeArticleHtml(html, { force: true });
  assert.doesNotMatch(out, /<script/i);
  assert.doesNotMatch(out, /window\.__analytics/);
  assert.doesNotMatch(out, /doTrack/);
  assert.match(out, /Keep this/);
  assert.match(out, /And this/);
});

test("normalize: strips <style> tags and their content", () => {
  const html = "<p>Text.</p><style>.ad { display: none; } .hidden { visibility: hidden; }</style>";
  const { html: out } = normalizeArticleHtml(html, { force: true });
  assert.doesNotMatch(out, /<style/i);
  assert.doesNotMatch(out, /\.ad \{/);
  assert.doesNotMatch(out, /visibility/);
  assert.match(out, /Text/);
});

test("normalize: strips <noscript> tags and their content", () => {
  const html = "<p>Content.</p><noscript><img src='tracking.gif'/></noscript><p>More.</p>";
  const { html: out } = normalizeArticleHtml(html, { force: true });
  assert.doesNotMatch(out, /<noscript/i);
  assert.doesNotMatch(out, /tracking\.gif/);
  assert.match(out, /Content/);
});

test("normalize: strips <template> tags and their content", () => {
  const html = "<p>Content.</p><template id='tmpl'><div>Template body</div></template>";
  const { html: out } = normalizeArticleHtml(html, { force: true });
  assert.doesNotMatch(out, /<template/i);
  assert.doesNotMatch(out, /Template body/);
  assert.match(out, /Content/);
});

test("normalize: removes inline event-handler attributes", () => {
  const html = '<p onclick="alert(1)" onmouseover="highlight()">Paragraph text.</p>';
  const { html: out } = normalizeArticleHtml(html, { force: true });
  assert.doesNotMatch(out, /onclick/);
  assert.doesNotMatch(out, /onmouseover/);
  assert.match(out, /Paragraph text/);
});

test("normalize: removes onerror on img (common XSS vector)", () => {
  const html = '<img src="photo.jpg" onerror="doEvil()" alt="Photo"/><p>Caption</p>';
  const { html: out } = normalizeArticleHtml(html, { force: true });
  assert.doesNotMatch(out, /onerror/);
  assert.match(out, /photo\.jpg/, "img src should be preserved");
  assert.match(out, /Caption/);
});

test("normalize: removes inline style attributes", () => {
  const html = '<p style="color:red;font-size:12px">Red paragraph.</p>';
  const { html: out } = normalizeArticleHtml(html, { force: true });
  assert.doesNotMatch(out, /style=/);
  assert.match(out, /Red paragraph/);
});

test("normalize: removes HTML comments", () => {
  const html = "<p>Text.</p><!-- analytics comment --><p>More text.</p>";
  const { html: out } = normalizeArticleHtml(html, { force: true });
  assert.doesNotMatch(out, /<!--/);
  assert.doesNotMatch(out, /analytics comment/);
  assert.match(out, /Text/);
  assert.match(out, /More text/);
});

// ---------------------------------------------------------------------------
// Content preservation
// ---------------------------------------------------------------------------

test("normalize: preserves all paragraph tags and their content", () => {
  const html = "<p>First paragraph.</p><p>Second paragraph.</p><p>Third paragraph.</p>";
  const { html: out } = normalizeArticleHtml(html, { force: true });
  const pMatches = out.match(/<p>/g) ?? [];
  assert.equal(pMatches.length, 3, "all 3 paragraphs should be preserved");
  assert.match(out, /First paragraph/);
  assert.match(out, /Second paragraph/);
  assert.match(out, /Third paragraph/);
});

test("normalize: preserves headings", () => {
  const html = "<h1>Main Title</h1><h2>Section Heading</h2><h3>Sub-section</h3><p>Body.</p>";
  const { html: out } = normalizeArticleHtml(html, { force: true });
  assert.match(out, /<h1>Main Title<\/h1>/);
  assert.match(out, /<h2>Section Heading<\/h2>/);
  assert.match(out, /<h3>Sub-section<\/h3>/);
});

test("normalize: preserves lists", () => {
  const html = "<ul><li>Item one</li><li>Item two</li></ul><ol><li>First</li></ol>";
  const { html: out } = normalizeArticleHtml(html, { force: true });
  assert.match(out, /Item one/);
  assert.match(out, /Item two/);
  assert.match(out, /First/);
  assert.match(out, /<ul>/);
  assert.match(out, /<ol>/);
});

test("normalize: preserves links with href", () => {
  const html = '<p>See <a href="https://example.com">this article</a> for more.</p>';
  const { html: out } = normalizeArticleHtml(html, { force: true });
  assert.match(out, /href="https:\/\/example\.com"/);
  assert.match(out, /this article/);
});

test("normalize: preserves images with src and alt", () => {
  const html = '<img src="photo.jpg" alt="A scenic view"/><figcaption>Caption text</figcaption>';
  const { html: out } = normalizeArticleHtml(html, { force: true });
  assert.match(out, /src="photo\.jpg"/);
  assert.match(out, /alt="A scenic view"/);
  assert.match(out, /Caption text/);
});

test("normalize: preserves paragraph count in complex article HTML", () => {
  const html =
    "<article>" +
    "<h1>Title</h1>" +
    '<script>window.ga=function(){}</script>' +
    '<style>.article{font-size:16px}</style>' +
    "<p>First paragraph of the article body.</p>" +
    '<div onclick="track()" class="social-widget">Share buttons</div>' +
    "<p>Second paragraph continues the narrative.</p>" +
    "<!-- ad placeholder -->" +
    "<p>Third paragraph concludes the piece.</p>" +
    "</article>";
  const { html: out } = normalizeArticleHtml(html, { force: true });
  const paragraphs = out.match(/<p>/g) ?? [];
  assert.equal(paragraphs.length, 3, "all 3 article paragraphs should survive normalization");
  assert.doesNotMatch(out, /<script/i);
  assert.doesNotMatch(out, /<style/i);
  assert.doesNotMatch(out, /onclick/);
  assert.doesNotMatch(out, /<!--/);
});

// ---------------------------------------------------------------------------
// Stats / metrics
// ---------------------------------------------------------------------------

test("normalize: compressionRatio < 1 when noisy scripts are stripped", () => {
  const noise = "x".repeat(1000);
  const html =
    "<p>Good content here.</p>" +
    `<script>${noise}</script>` +
    `<style>${noise}</style>`;
  const result = normalizeArticleHtml(html, { force: true });
  assert.ok(
    result.compressionRatio < 1,
    `Expected compressionRatio < 1, got ${result.compressionRatio}`,
  );
  assert.ok(result.normalizedLength < result.originalLength);
  assert.match(result.html, /Good content/);
});

test("normalize: originalLength matches Buffer.byteLength of input", () => {
  const html = "<p>Some UTF-8 content: café, naïve, résumé.</p>";
  const result = normalizeArticleHtml(html, { force: true });
  assert.equal(result.originalLength, Buffer.byteLength(html, "utf8"));
});

test("normalize: normalizedLength matches Buffer.byteLength of output html", () => {
  const html = "<p>Content</p><script>x=1</script>";
  const result = normalizeArticleHtml(html, { force: true });
  assert.equal(result.normalizedLength, Buffer.byteLength(result.html, "utf8"));
});

test("normalize: compressionRatio is normalizedLength/originalLength", () => {
  const html = "<p>Content</p><script>" + "y".repeat(500) + "</script>";
  const result = normalizeArticleHtml(html, { force: true });
  const expected = result.normalizedLength / result.originalLength;
  assert.ok(
    Math.abs(result.compressionRatio - expected) < 0.0001,
    `Expected ratio ~${expected.toFixed(4)}, got ${result.compressionRatio}`,
  );
});
