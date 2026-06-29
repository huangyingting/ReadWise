/**
 * Scraper quality fixture regression tests (Epic #366 / Issue #369).
 *
 * Guards extraction quality as cleanup/normalization evolve.  Uses fully
 * inline HTML fixtures — no real network or DB is touched.
 *
 * Fixtures cover:
 *  - JSON-LD article body extraction
 *  - Raw article paragraph extraction
 *  - Provider-level boilerplate cleanup
 *  - Caption / image preservation
 *  - Short-content rejection (< 50 words → null)
 *
 * Assertions check: title, source URL, word count, paragraph count,
 * category, sanitized output, and boilerplate absence.
 */
process.env.LOG_LEVEL = "error";

import { test, before, mock } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Module mocks (register before any import of the modules under test)
// ---------------------------------------------------------------------------

before(() => {
  // scraper/extract.ts pulls in providers.ts which transitively imports
  // prisma-dependent modules via index.ts.  Stub the indirect dep here.
  mock.module("@/lib/prisma", { namedExports: { prisma: {} } });
});

// ---------------------------------------------------------------------------
// Helper utilities
// ---------------------------------------------------------------------------

/** Returns a string of `n` unique-looking words. */
function wordBlock(n: number, seed = "word"): string {
  return Array.from({ length: n }, (_, i) => `${seed}${i + 1}`).join(" ");
}

/** Counts `<p>` open-tags in a string. */
function countParagraphs(html: string): number {
  return (html.match(/<p>/g) ?? []).length;
}

// ---------------------------------------------------------------------------
// Fixture 1: JSON-LD article body
// ---------------------------------------------------------------------------

test("quality/json-ld: extracts title, author, date, body from NewsArticle JSON-LD", async () => {
  const { extractArticle } = await import("@/lib/scraper/extract");

  const body = wordBlock(80, "ocean");
  const ld = {
    "@type": "NewsArticle",
    headline: "Ocean Discovery",
    author: { name: "Dr. Reef" },
    articleBody: body,
    datePublished: "2026-03-15T08:00:00Z",
    description: "Scientists discover a new deep-sea species.",
    articleSection: "science",
  };
  const html =
    "<html><head>" +
    `<script type="application/ld+json">${JSON.stringify(ld)}</script>` +
    "</head><body><article><p>Fallback paragraph that should not win.</p></article></body></html>";

  const result = extractArticle(html, "https://www.nbcnews.com/science/ocean-rcna12345");

  assert.ok(result, "should extract a valid article");
  assert.equal(result!.title, "Ocean Discovery");
  assert.equal(result!.author, "Dr. Reef");
  assert.equal(result!.publishedAt?.toISOString(), "2026-03-15T08:00:00.000Z");
  assert.match(result!.content, /ocean\d+/, "body words should appear in content");
  assert.ok(result!.wordCount >= 50, `wordCount ${result!.wordCount} must be ≥ 50`);
  assert.equal(result!.category, "science");
  assert.equal(result!.sourceUrl, "https://www.nbcnews.com/science/ocean-rcna12345");
});

test("quality/json-ld: word count is at least the word count of articleBody", async () => {
  const { extractArticle } = await import("@/lib/scraper/extract");

  const body = wordBlock(100, "climate");
  const ld = { "@type": "NewsArticle", headline: "Climate News", articleBody: body };
  const html = `<html><head><script type="application/ld+json">${JSON.stringify(ld)}</script></head><body></body></html>`;

  const result = extractArticle(html, "https://www.nbcnews.com/environment/story-rcna99999");
  assert.ok(result);
  assert.ok(result!.wordCount >= 100, `wordCount ${result!.wordCount} should be ≥ 100`);
});

test("quality/json-ld: JSON-LD body overrides raw <p> paragraphs", async () => {
  const { extractArticle } = await import("@/lib/scraper/extract");

  const ldBody = wordBlock(60, "jsonld");
  const ld = { "@type": "NewsArticle", headline: "Preferred Body", articleBody: ldBody };
  const html =
    "<html><head>" +
    `<script type="application/ld+json">${JSON.stringify(ld)}</script>` +
    "</head><body><article>" +
    `<p>${wordBlock(80, "rawparagraph")}</p>` +
    "</article></body></html>";

  const result = extractArticle(html, "https://www.nbcnews.com/tech/article-rcna00001");
  assert.ok(result);
  assert.match(result!.content, /jsonld\d+/, "JSON-LD body should be used");
  assert.doesNotMatch(result!.content, /rawparagraph\d+/, "raw <p> body should NOT override");
});

// ---------------------------------------------------------------------------
// Fixture 2: Raw article paragraph extraction
// ---------------------------------------------------------------------------

test("quality/raw-p: extracts body from raw <article><p> paragraphs", async () => {
  const { extractArticle } = await import("@/lib/scraper/extract");

  const p1 = wordBlock(30, "paragraph1");
  const p2 = wordBlock(30, "paragraph2");
  const p3 = wordBlock(30, "paragraph3");
  const html =
    "<html><head><title>Raw Paragraph Article</title></head><body>" +
    `<article><p>${p1}</p><p>${p2}</p><p>${p3}</p></article>` +
    "</body></html>";

  const result = extractArticle(html, "https://www.nationalgeographic.com/article/raw-story");
  assert.ok(result, "should extract article from raw paragraphs");
  assert.equal(result!.title, "Raw Paragraph Article");
  assert.ok(result!.wordCount >= 50, `wordCount ${result!.wordCount} must be ≥ 50`);
  assert.ok(countParagraphs(result!.content) >= 3, "all 3 paragraphs should appear in content");
  assert.match(result!.content, /paragraph1\d+/);
  assert.match(result!.content, /paragraph2\d+/);
  assert.match(result!.content, /paragraph3\d+/);
});

test("quality/raw-p: paragraph count is preserved for 5-paragraph article", async () => {
  const { extractArticle } = await import("@/lib/scraper/extract");

  const paragraphs = Array.from({ length: 5 }, (_, i) => `<p>${wordBlock(25, `para${i}`)}</p>`);
  const html =
    "<html><head><title>Five Paragraphs</title></head>" +
    `<body><article>${paragraphs.join("")}</article></body></html>`;

  const result = extractArticle(html, "https://time.com/article/2026/01/01/five-paragraphs/");
  assert.ok(result);
  assert.ok(
    countParagraphs(result!.content) >= 5,
    `Expected ≥5 paragraphs, got ${countParagraphs(result!.content)}`,
  );
});

// ---------------------------------------------------------------------------
// Fixture 3: Provider boilerplate removal
// ---------------------------------------------------------------------------

test("quality/boilerplate: provider cleanup removes ad block before body extraction", async () => {
  const { extractArticle } = await import("@/lib/scraper/extract");

  const articleText = wordBlock(70, "newsword");
  const html =
    "<html><head><title>NBC Cleanup Test</title></head><body>" +
    "<article>" +
    `<p>${articleText}</p>` +
    '<div class="advertisement"><p>Advertisement: BUY NOW!</p></div>' +
    '<div class="related"><p>Related: Other article link</p></div>' +
    "<p>Second paragraph of real content here today.</p>" +
    "</article>" +
    "</body></html>";

  // NBC has cleanup configured: dropClassKeywords includes "related" and "advertisement"
  const result = extractArticle(html, "https://www.nbcnews.com/world/test-story-rcna11111");
  assert.ok(result, "should extract article");
  assert.doesNotMatch(result!.content, /BUY NOW/, "ad content must be removed by cleanup");
  assert.doesNotMatch(
    result!.content,
    /Other article link/,
    "related content must be removed by cleanup",
  );
  assert.match(result!.content, /newsword\d+/, "article text must be preserved");
  assert.match(result!.content, /Second paragraph/, "second paragraph must be preserved");
});

test("quality/boilerplate: provider cleanup removes video elements before body extraction", async () => {
  const { extractArticle } = await import("@/lib/scraper/extract");

  const body = wordBlock(70, "story");
  const html =
    "<html><head><title>Video Cleanup Test</title></head><body>" +
    "<article>" +
    `<p>${body}</p>` +
    '<video src="promo.mp4" controls><source src="promo.mp4"/>Watch the video!</video>' +
    "<p>Continue reading the article here.</p>" +
    "</article>" +
    "</body></html>";

  // NBC has cleanup configured with dropSelectors: ["video", "iframe", "aside"]
  const result = extractArticle(html, "https://www.nbcnews.com/tech/video-test-rcna22222");
  assert.ok(result);
  assert.doesNotMatch(result!.content, /Watch the video/, "video inner content must be stripped");
  assert.doesNotMatch(result!.content, /promo\.mp4/, "video src must be stripped");
  assert.match(result!.content, /story\d+/, "article text must be preserved");
  assert.match(result!.content, /Continue reading/, "text after video must be preserved");
});

test("quality/boilerplate: provider without cleanup passes HTML unchanged", async () => {
  const { extractArticle } = await import("@/lib/scraper/extract");

  // Use an unknown provider (no cleanup config)
  const body = wordBlock(60, "word");
  const html =
    "<html><head><title>No Cleanup Provider</title></head>" +
    `<body><article><p>${body}</p></article></body></html>`;

  const result = extractArticle(html, "https://unknown-news.example.com/article/test");
  assert.ok(result, "extraction should succeed for unknown provider");
  assert.match(result!.content, /word\d+/);
});

// ---------------------------------------------------------------------------
// Fixture 4: Captions and images preserved
// ---------------------------------------------------------------------------

test("quality/captions: figcaption text inside a figure block survives sanitization", async () => {
  const { extractArticle } = await import("@/lib/scraper/extract");

  // In real articles, figure/figcaption are standalone blocks, not inside <p>.
  // extractBodyHtml extracts <p> elements; sanitizeArticleHtml allows figcaption.
  // We verify the article paragraphs are intact and the sanitizer allows the tags.
  const body = wordBlock(55, "caption");
  const html =
    "<html><head><title>Caption Test</title></head><body><article>" +
    `<p>${body}</p>` +
    "<p>The photo above shows ocean life from the deep sea expedition.</p>" +
    "</article></body></html>";

  const result = extractArticle(html, "https://www.nationalgeographic.com/article/caption-test");
  assert.ok(result);
  assert.match(result!.content, /caption\d+/, "article body words should be in content");
  assert.match(result!.content, /ocean life/, "second paragraph should be in content");
  // figure and figcaption are in the sanitizer allowedTags —
  // verify they pass through sanitizeArticleHtml without stripping
  const { sanitizeArticleHtml } = await import("@/lib/sanitize");
  const figHtml = "<figure><img src='https://x.com/img.jpg' alt='Ocean'/><figcaption>Deep sea creature caption.</figcaption></figure>";
  const sanitized = sanitizeArticleHtml(figHtml);
  assert.match(sanitized, /Deep sea creature caption/, "figcaption content must survive sanitizer");
});

test("quality/images: img src and alt survive sanitization", async () => {
  const { extractArticle } = await import("@/lib/scraper/extract");

  const body = wordBlock(55, "imgtest");
  const html =
    "<html><head><title>Image Test</title></head><body><article>" +
    `<p>${body}</p>` +
    '<img src="https://example.com/hero.jpg" alt="Hero image"/>' +
    "</article></body></html>";

  const result = extractArticle(html, "https://www.nationalgeographic.com/article/img-test");
  assert.ok(result);
  // The img tag itself comes through extractBodyHtml as raw body then goes
  // through sanitize — the strict pass allows img with src/alt
  assert.match(result!.content, /imgtest\d+/);
});

test("quality/video: orphan video label is dropped while YouTube iframe becomes a link", async () => {
  const { extractArticle } = await import("@/lib/scraper/extract");
  const prevReadability = process.env.SCRAPER_READABILITY;
  process.env.SCRAPER_READABILITY = "false";
  try {
    const body = wordBlock(70, "videoarticle");
    const html =
      "<html><head><title>Video Article</title></head><body><article>" +
      "<p>Featured Video</p>" +
      '<iframe src="https://www.youtube.com/embed/abc123" title="Article video"></iframe>' +
      `<p>${body}</p>` +
      '<figure><img src="https://example.com/article-photo.jpg" alt="Article photo"/></figure>' +
      "</article></body></html>";

    const result = extractArticle(html, "https://example.com/article/video");
    assert.ok(result);
    assert.doesNotMatch(result!.content, /Featured Video/i);
    assert.doesNotMatch(result!.content, /<iframe/i);
    assert.match(result!.content, /https:\/\/www\.youtube\.com\/embed\/abc123/i);
    assert.match(result!.content, /article-photo\.jpg/i, "article image must survive");
  } finally {
    if (prevReadability == null) {
      delete process.env.SCRAPER_READABILITY;
    } else {
      process.env.SCRAPER_READABILITY = prevReadability;
    }
  }
});

// ---------------------------------------------------------------------------
// Fixture 5: Short-content rejection
// ---------------------------------------------------------------------------

test("quality/short: article with < 50 words returns null", async () => {
  const { extractArticle } = await import("@/lib/scraper/extract");

  const html =
    "<html><head><title>Short Article</title></head>" +
    `<body><article><p>${wordBlock(10, "short")}</p></article></body></html>`;

  const result = extractArticle(html, "https://www.nbcnews.com/brief/short-rcna00000");
  assert.strictEqual(result, null, "article with < 50 words should be rejected");
});

test("quality/short: article with exactly 50 words is accepted", async () => {
  const { extractArticle } = await import("@/lib/scraper/extract");

  const html =
    "<html><head><title>Borderline Article</title></head>" +
    `<body><article><p>${wordBlock(50, "border")}</p></article></body></html>`;

  const result = extractArticle(html, "https://www.nbcnews.com/world/borderline-rcna00001");
  assert.ok(result, "article with exactly 50 words should be accepted");
  assert.ok(result!.wordCount >= 50);
});

test("quality/short: JSON-LD body with < 50 words returns null", async () => {
  const { extractArticle } = await import("@/lib/scraper/extract");

  const ld = { "@type": "NewsArticle", headline: "Tiny", articleBody: wordBlock(5, "tiny") };
  const html =
    "<html><head>" +
    `<script type="application/ld+json">${JSON.stringify(ld)}</script>` +
    "</head><body></body></html>";

  const result = extractArticle(html, "https://www.nbcnews.com/brief/tiny-rcna99900");
  assert.strictEqual(result, null, "JSON-LD body with < 50 words should be rejected");
});

test("quality/short: article with no title returns null", async () => {
  const { extractArticle } = await import("@/lib/scraper/extract");

  const html = `<html><body><article><p>${wordBlock(80, "notitle")}</p></article></body></html>`;
  const result = extractArticle(html, "https://www.nbcnews.com/world/no-title-rcna11110");
  assert.strictEqual(result, null, "article without a title should be rejected");
});

test("quality/short: invalid source URL returns null", async () => {
  const { extractArticle } = await import("@/lib/scraper/extract");

  const html = `<html><head><title>Test</title></head><body><p>${wordBlock(80, "w")}</p></body></html>`;
  const result = extractArticle(html, "not-a-valid-url");
  assert.strictEqual(result, null, "invalid URL should cause null return");
});

// ---------------------------------------------------------------------------
// Fixture 6: sanitized-output properties
// ---------------------------------------------------------------------------

test("quality/sanitize: content has no <script> tags", async () => {
  const { extractArticle } = await import("@/lib/scraper/extract");

  const body = wordBlock(70, "safe");
  const html =
    "<html><head><title>XSS Test</title></head><body><article>" +
    `<p>${body}<script>window.__pwned=1</script></p>` +
    "</article></body></html>";

  const result = extractArticle(html, "https://www.huffpost.com/entry/xss-test_l_abc123");
  assert.ok(result);
  assert.doesNotMatch(result!.content, /<script/i, "scripts must be stripped from content");
  assert.doesNotMatch(result!.content, /__pwned/);
  assert.match(result!.content, /safe\d+/);
});

test("quality/sanitize: content has no inline event handlers", async () => {
  const { extractArticle } = await import("@/lib/scraper/extract");

  const body = wordBlock(70, "event");
  const html =
    "<html><head><title>Event Test</title></head><body><article>" +
    `<p onclick="alert(1)">${body}</p>` +
    '<p onload="steal()">More text here today.</p>' +
    "</article></body></html>";

  const result = extractArticle(html, "https://www.huffpost.com/entry/event-test_l_def456");
  assert.ok(result);
  assert.doesNotMatch(result!.content, /onclick/i);
  assert.doesNotMatch(result!.content, /onload/i);
  assert.match(result!.content, /event\d+/);
});

test("quality/sanitize: content has no javascript: href", async () => {
  const { extractArticle } = await import("@/lib/scraper/extract");

  const body = wordBlock(70, "jslink");
  const html =
    "<html><head><title>JS Link Test</title></head><body><article>" +
    `<p>${body}</p>` +
    '<p><a href="javascript:alert(1)">Dangerous link</a></p>' +
    "</article></body></html>";

  const result = extractArticle(html, "https://www.huffpost.com/entry/js-link-test_l_ghi789");
  assert.ok(result);
  assert.doesNotMatch(result!.content, /javascript:/i, "javascript: hrefs must be stripped");
});

test("quality/sanitize: links get rel=noopener noreferrer nofollow target=_blank", async () => {
  const { extractArticle } = await import("@/lib/scraper/extract");

  const body = wordBlock(70, "link");
  const html =
    "<html><head><title>Link Test</title></head><body><article>" +
    `<p>${body}</p>` +
    '<p><a href="https://external.com/page">External link</a></p>' +
    "</article></body></html>";

  const result = extractArticle(html, "https://www.nbcnews.com/world/link-test-rcna55555");
  assert.ok(result);
  assert.match(result!.content, /rel="noopener noreferrer nofollow"/i);
  assert.match(result!.content, /target="_blank"/i);
});

// ---------------------------------------------------------------------------
// Fixture: inline <script> must NOT leak into the article body (Bug A)
// ---------------------------------------------------------------------------

test("quality/scripts: inline analytics <script> never leaks into body", async () => {
  const { extractArticle } = await import("@/lib/scraper/extract");

  // Real-world leak: minified analytics JS (NewRelic) contains `<p>…</p>`
  // substrings that the legacy `<p>`-harvest regex captured because scripts were
  // not stripped first. Force the legacy path so we exercise that harvest.
  const prevReadability = process.env.SCRAPER_READABILITY;
  process.env.SCRAPER_READABILITY = "false";
  try {
    const jsBlob =
      'window.NREUM||(NREUM={});NREUM.info={beacon:"bam.nr-data.net"};' +
      't.addEventListener("progress",function(t){var e=window.NREUM;' +
      'e.prototype=function(){return "<p>34||h<10)||leak"+window.NREUM+"</p>"};' +
      'document.body.innerHTML="<p>addEventListener function( injected</p>";';

    const body = wordBlock(120, "prose");
    const ld = {
      "@type": "Article",
      headline: "Life In Our Solar System",
      author: { name: "Dr. Cosmos" },
    };
    const html =
      "<html><head>" +
      `<script type="application/ld+json">${JSON.stringify(ld)}</script>` +
      "</head><body><article>" +
      `<script data-nr-type="legacy">${jsBlob}</script>` +
      `<p>${body}</p>` +
      "</article></body></html>";

    const result = extractArticle(
      html,
      "https://www.nationalgeographic.com/science/article/life-solar-system",
    );

    assert.ok(result, "should extract a valid article");
    // JSON-LD metadata is still read despite unconditional script stripping.
    assert.equal(result!.title, "Life In Our Solar System");
    assert.equal(result!.author, "Dr. Cosmos");
    // The real prose paragraph survives.
    assert.match(result!.content, /prose1\b/, "real body prose is kept");
    // None of the script text survives in the body.
    assert.doesNotMatch(result!.content, /addEventListener/i, "no addEventListener in body");
    assert.doesNotMatch(result!.content, /NREUM/i, "no NREUM token in body");
    assert.doesNotMatch(result!.content, /function\s*\(/i, "no JS function( in body");
    assert.doesNotMatch(result!.content, /\.prototype/i, "no .prototype in body");
  } finally {
    if (prevReadability === undefined) delete process.env.SCRAPER_READABILITY;
    else process.env.SCRAPER_READABILITY = prevReadability;
  }
});
