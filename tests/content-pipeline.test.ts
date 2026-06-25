/**
 * End-to-end fixture tests for the content transformation and HTML safety
 * pipeline (REF-072).
 *
 * Tests cover the full sequence:
 *   raw HTML → sanitized stored HTML → reader text → paragraph splits
 *
 * No database, network, AI, or storage seams needed — all functions are pure.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Stage 3 — Strict sanitization
// ---------------------------------------------------------------------------

describe("sanitizeArticleHtml", async () => {
  const { sanitizeArticleHtml } = await import("@/lib/content-pipeline");

  test("strips script/style tags and their content", () => {
    const out = sanitizeArticleHtml("<p>Keep</p><script>alert(1)</script><style>.x{}</style>");
    assert.match(out, /Keep/);
    assert.doesNotMatch(out, /alert/);
    assert.doesNotMatch(out, /\.x\{/);
  });

  test("drops ad/boilerplate blocks together with their content", () => {
    const out = sanitizeArticleHtml('<div class="advertisement">BUY NOW</div><p>Real content</p>');
    assert.doesNotMatch(out, /BUY NOW/);
    assert.match(out, /Real content/);
  });

  test("strips structural wrappers but preserves inner text", () => {
    const out = sanitizeArticleHtml("<div><span>Hello</span> world</div>");
    assert.doesNotMatch(out, /<div|<span/);
    assert.match(out, /Hello/);
    assert.match(out, /world/);
  });

  test("preserves safe links and drops unsafe schemes", () => {
    const safe = sanitizeArticleHtml('<a href="https://x.com">link</a>');
    assert.match(safe, /href="https:\/\/x\.com"/);
    const js = sanitizeArticleHtml('<a href="javascript:alert(1)">x</a>');
    assert.doesNotMatch(js, /javascript:/);
  });

  test("adds rel and target to all links", () => {
    const out = sanitizeArticleHtml('<a href="https://example.com">click</a>');
    assert.match(out, /rel="noopener noreferrer nofollow"/);
    assert.match(out, /target="_blank"/);
  });

  test("disallowed tags are removed, text kept", () => {
    const out = sanitizeArticleHtml("<marquee>Spin</marquee><p>ok</p>");
    assert.doesNotMatch(out, /<marquee/);
    assert.match(out, /Spin/);
    assert.match(out, /<p>ok<\/p>/);
  });
});

// ---------------------------------------------------------------------------
// Stage 4 — Reader text extraction
// ---------------------------------------------------------------------------

describe("articleHtmlToReaderText", async () => {
  const { articleHtmlToReaderText, htmlToPlainText } = await import("@/lib/content-pipeline");

  test("strips tags and normalises whitespace", () => {
    assert.equal(articleHtmlToReaderText("<p>Hello</p><p>World</p>"), "Hello World");
  });

  test("preserves link text", () => {
    assert.equal(
      articleHtmlToReaderText('<p>Read <a href="https://example.com">the source</a>.</p>'),
      "Read the source.",
    );
  });

  test("decodes HTML entities", () => {
    assert.equal(articleHtmlToReaderText("<p>AT&amp;T &amp; friends</p>"), "AT&T & friends");
    assert.equal(articleHtmlToReaderText("<p>Price: &lt;$10&gt;</p>"), "Price: <$10>");
    assert.equal(articleHtmlToReaderText("<p>caf&#233;</p>"), "café");
    assert.equal(articleHtmlToReaderText("<p>&nbsp;leading space</p>"), "leading space");
  });

  test("collapses internal whitespace", () => {
    assert.equal(
      articleHtmlToReaderText("<p>Too   many   spaces</p>"),
      "Too many spaces",
    );
  });

  test("strips ad/boilerplate from reader text", () => {
    const text = articleHtmlToReaderText(
      '<div class="advertisement">PROMO</div><p>Article body</p>',
    );
    assert.doesNotMatch(text, /PROMO/);
    assert.match(text, /Article body/);
  });

  test("htmlToPlainText is a backwards-compat alias", () => {
    const html = "<p>Test content</p>";
    assert.equal(htmlToPlainText(html), articleHtmlToReaderText(html));
  });
});

// ---------------------------------------------------------------------------
// End-to-end fixture: raw HTML → sanitized HTML → reader text → paragraphs
// ---------------------------------------------------------------------------

describe("full pipeline fixture", async () => {
  const { sanitizeArticleHtml, articleHtmlToReaderText } = await import("@/lib/content-pipeline");
  const { splitHtmlParagraphs, splitTranslationParagraphs, alignParagraphs } = await import(
    "@/lib/bilingual"
  );

  // Raw article HTML as it might arrive from a provider (before any processing).
  const RAW_HTML = `
    <html>
      <head>
        <script>window.__ads = {}; trackView();</script>
        <style>.paywall { display: none; }</style>
      </head>
      <body>
        <div class="newsletter-signup">Subscribe to our newsletter!</div>
        <article>
          <h1>A Guide to Reading</h1>
          <p>Reading <strong>widely</strong> improves vocabulary &amp; comprehension.</p>
          <p>Regular practice builds <em>long-term</em> retention.</p>
          <p onclick="track()">Consistency is the key to mastery.</p>
          <div class="ads">Buy this product now!</div>
        </article>
      </body>
    </html>
  `;

  test("sanitized HTML removes scripts, ads, and unsafe attributes", () => {
    const sanitized = sanitizeArticleHtml(RAW_HTML);
    // Scripts and styles stripped
    assert.doesNotMatch(sanitized, /<script/i);
    assert.doesNotMatch(sanitized, /<style/i);
    assert.doesNotMatch(sanitized, /window\.__ads/);
    assert.doesNotMatch(sanitized, /paywall/);
    // Boilerplate blocks stripped
    assert.doesNotMatch(sanitized, /Subscribe to our newsletter/);
    assert.doesNotMatch(sanitized, /Buy this product/);
    // Unsafe attributes stripped
    assert.doesNotMatch(sanitized, /onclick/);
    // Content-bearing elements preserved
    assert.match(sanitized, /A Guide to Reading/);
    assert.match(sanitized, /Reading/);
    assert.match(sanitized, /Regular practice/);
    assert.match(sanitized, /Consistency/);
  });

  test("reader text is a clean, entity-decoded plain-text string", () => {
    const sanitized = sanitizeArticleHtml(RAW_HTML);
    const text = articleHtmlToReaderText(sanitized);
    // Decoded entities
    assert.match(text, /vocabulary & comprehension/);
    // No HTML tags remain
    assert.doesNotMatch(text, /<[a-z]/i);
    // Stripped content is absent
    assert.doesNotMatch(text, /Subscribe/);
    assert.doesNotMatch(text, /Buy this/);
    // Article content present
    assert.match(text, /A Guide to Reading/);
    assert.match(text, /Reading widely/);
    assert.match(text, /Consistency is the key/);
  });

  test("paragraph count from sanitized HTML is correct", () => {
    const sanitized = sanitizeArticleHtml(RAW_HTML);
    const paragraphs = splitHtmlParagraphs(sanitized);
    // h1 + 3 <p> paragraphs (ad div stripped by sanitizer)
    assert.equal(paragraphs.length, 4);
  });

  test("paragraphs align 1:1 with translated text when counts match", () => {
    const sanitized = sanitizeArticleHtml(RAW_HTML);
    const srcParagraphs = splitHtmlParagraphs(sanitized);
    const translatedText = srcParagraphs.map((_, i) => `Translated paragraph ${i + 1}`).join("\n\n");
    const transParagraphs = splitTranslationParagraphs(translatedText);
    const aligned = alignParagraphs(srcParagraphs, transParagraphs);
    assert.equal(aligned.length, srcParagraphs.length);
    for (const pair of aligned) {
      assert.ok(pair.trans !== null, "every source paragraph should have a translation");
    }
  });
});

// ---------------------------------------------------------------------------
// Anchor / highlight stability
// ---------------------------------------------------------------------------

describe("anchor stability", async () => {
  const { sanitizeArticleHtml, articleHtmlToReaderText } = await import("@/lib/content-pipeline");

  test("same stored HTML always produces the same reader text", () => {
    const html = "<p>Hello <strong>world</strong>! This is an <em>article</em>.</p>";
    const first = articleHtmlToReaderText(html);
    const second = articleHtmlToReaderText(html);
    assert.equal(first, second, "reader text must be deterministic");
  });

  test("word offsets are stable across calls for highlight anchoring", () => {
    const html =
      "<p>The quick brown fox jumps over the lazy dog.</p>" +
      "<p>Pack my box with five dozen liquor jugs.</p>";
    const text = articleHtmlToReaderText(html);
    const targetWord = "fox";
    const offset1 = text.indexOf(targetWord);
    const offset2 = articleHtmlToReaderText(html).indexOf(targetWord);
    assert.ok(offset1 >= 0, "target word must be present in reader text");
    assert.equal(offset1, offset2, "word offset must be stable across calls");
  });

  test("sanitizeArticleHtml is idempotent (re-sanitizing does not alter output)", () => {
    const html = "<p>Article with <strong>bold</strong> and <a href='https://x.com'>link</a>.</p>";
    const once = sanitizeArticleHtml(html);
    const twice = sanitizeArticleHtml(once);
    assert.equal(once, twice, "sanitization must be idempotent");
  });
});
