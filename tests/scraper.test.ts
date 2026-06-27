import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decodeEntities,
  stripTags,
  metaContent,
  extractArticleJsonLd,
  extractArticle,
} from "@/lib/scraper/extract";

test("decodeEntities handles named and numeric entities", () => {
  assert.equal(decodeEntities("a &amp; b &lt;c&gt; &#39;x&#39;"), "a & b <c> 'x'");
  assert.equal(decodeEntities("&#x27;quote&#x27;"), "'quote'");
});

test("stripTags removes markup and collapses whitespace", () => {
  assert.equal(stripTags("<p>Hello   <b>world</b></p>"), "Hello world");
});

test("metaContent reads property/name meta tags in either attribute order", () => {
  const html =
    '<meta property="og:title" content="My Title">' +
    '<meta content="Jane" name="author">';
  assert.equal(metaContent(html, "og:title"), "My Title");
  assert.equal(metaContent(html, "author"), "Jane");
  assert.equal(metaContent(html, "missing"), null);
});

test("extractArticleJsonLd finds the NewsArticle node within @graph", () => {
  const ld = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "WebPage" },
      { "@type": "NewsArticle", headline: "Big News" },
    ],
  };
  const html = `<script type="application/ld+json">${JSON.stringify(ld)}</script>`;
  const node = extractArticleJsonLd(html);
  assert.ok(node);
  assert.equal(node?.headline, "Big News");
});

function buildBody(words: number): string {
  return "<p>" + Array.from({ length: words }, () => "word").join(" ") + "</p>";
}

test("extractArticle parses JSON-LD article into a cleaned record", () => {
  const ld = {
    "@type": "NewsArticle",
    headline: "Climate Update",
    author: { name: "Sam Reporter" },
    articleBody: Array.from({ length: 80 }, () => "rain").join(" "),
    datePublished: "2026-01-02T10:00:00Z",
    description: "A short summary.",
  };
  const html =
    `<html><head><title>Fallback</title>` +
    `<script type="application/ld+json">${JSON.stringify(ld)}</script>` +
    `</head><body></body></html>`;
  const result = extractArticle(html, "https://www.nbcnews.com/science/story");
  assert.ok(result);
  assert.equal(result?.title, "Climate Update");
  assert.equal(result?.author, "Sam Reporter");
  assert.ok((result?.wordCount ?? 0) >= 50);
  assert.match(result?.content ?? "", /rain/);
  assert.equal(result?.publishedAt?.toISOString(), "2026-01-02T10:00:00.000Z");
});

test("extractArticle rejects bodies under 50 words", () => {
  const html =
    "<html><head><title>Tiny</title></head><body><article>" +
    buildBody(5) +
    "</article></body></html>";
  assert.equal(extractArticle(html, "https://www.nbcnews.com/x"), null);
});

test("extractArticle returns null without a title", () => {
  const html = "<html><body><article>" + buildBody(80) + "</article></body></html>";
  assert.equal(extractArticle(html, "https://www.nbcnews.com/x"), null);
});

test("extractArticle returns null for an invalid URL", () => {
  const html = "<html><head><title>T</title></head><body></body></html>";
  assert.equal(extractArticle(html, "not a url"), null);
});

test("extractArticle sanitizes scraped body HTML (strips script/onerror/javascript:)", () => {
  const filler = Array.from({ length: 60 }, () => "word").join(" ");
  const html =
    "<html><head><title>Malicious Page</title></head><body><article>" +
    `<p>Intro ${filler}<script>window.__pwned=1;alert('xss')</script> trailing.</p>` +
    `<p><img src="x" onerror="alert('xss')"> ` +
    `<a href="javascript:alert('xss')">click</a> ${filler}</p>` +
    "</article></body></html>";
  const result = extractArticle(html, "https://www.nbcnews.com/security/story");
  assert.ok(result, "article should still extract");
  const content = result?.content ?? "";
  // Sanitizer must remove the dangerous constructs entirely.
  assert.doesNotMatch(content, /<script/i, "no <script> tags");
  assert.doesNotMatch(content, /onerror/i, "no inline event handlers");
  assert.doesNotMatch(content, /javascript:/i, "no javascript: scheme");
  // ...while preserving legitimate prose.
  assert.match(content, /word/);
});

test("extractArticle sanitizes a malicious JSON-LD headline path's body", () => {
  const ld = {
    "@type": "NewsArticle",
    headline: "Breaking <img src=x onerror=alert(1)> News",
    articleBody: Array.from({ length: 80 }, () => "ocean").join(" "),
    datePublished: "2026-02-03T08:00:00Z",
  };
  const html =
    "<html><head><title>Fallback</title>" +
    `<script type="application/ld+json">${JSON.stringify(ld)}</script>` +
    "</head><body></body></html>";
  const result = extractArticle(html, "https://www.nbcnews.com/world/story");
  assert.ok(result);
  // Body comes from articleBody (plain text) -> no markup leaks into content.
  assert.doesNotMatch(result?.content ?? "", /onerror/i);
  assert.doesNotMatch(result?.content ?? "", /<img/i);
  assert.match(result?.content ?? "", /ocean/);
});

// ---------------------------------------------------------------------------
// Clean-capture pipeline: Readability + declutter (#838–#840 integration)
// ---------------------------------------------------------------------------

/** Builds a unique-word block so assertions can target the real body. */
function wordBlock(n: number, seed: string): string {
  return Array.from({ length: n }, (_, i) => `${seed}${i + 1}`).join(" ");
}

test("extractArticle (clean capture): removes the trailing author-bio paragraph but keeps the body", () => {
  // Full page, no JSON-LD -> the raw-<p> / Readability path. The article ends
  // with a "By Jane Doe. Jane is a senior writer at …" bio paragraph that the
  // declutter pass must strip while the real prose is preserved end-to-end.
  const html =
    "<html><head><title>The Future of Cities</title>" +
    '<meta name="author" content="Jane Doe">' +
    "</head><body><article>" +
    `<p>Cities are changing. ${wordBlock(40, "urban")} and more.</p>` +
    `<p>The shift continues. ${wordBlock(40, "transit")} every day.</p>` +
    "<p>By Jane Doe. Jane is a senior writer at Example Magazine covering urban affairs.</p>" +
    "</article></body></html>";

  const result = extractArticle(html, "https://unknown-news.example.com/article/future-cities");
  assert.ok(result, "should extract a valid article");
  assert.equal(result?.title, "The Future of Cities");
  // Real article body survives.
  assert.match(result?.content ?? "", /urban\d+/, "first body paragraph must be kept");
  assert.match(result?.content ?? "", /transit\d+/, "second body paragraph must be kept");
  // The trailing author byline/bio (the user's core complaint) is GONE.
  assert.doesNotMatch(
    result?.content ?? "",
    /senior writer at Example Magazine/,
    "author bio sentence must be removed",
  );
  assert.doesNotMatch(result?.content ?? "", /By Jane Doe/, "trailing byline must be removed");
  // Author metadata is still captured.
  assert.equal(result?.author, "Jane Doe");
});

test("extractArticle (clean capture): SCRAPER_READABILITY=false still yields a valid article via the legacy + declutter path", () => {
  const prev = process.env.SCRAPER_READABILITY;
  process.env.SCRAPER_READABILITY = "false";
  try {
    const html =
      "<html><head><title>Legacy Path Article</title>" +
      '<meta name="author" content="Jane Doe">' +
      "</head><body><article>" +
      `<p>Cities are changing. ${wordBlock(40, "legacy")} and more.</p>` +
      `<p>The shift continues. ${wordBlock(40, "fallback")} every day.</p>` +
      "<p>By Jane Doe. Jane is a senior writer at Example Magazine covering urban affairs.</p>" +
      "</article></body></html>";

    const result = extractArticle(html, "https://unknown-news.example.com/article/legacy");
    assert.ok(result, "legacy path should still extract a valid article");
    // Full body preserved by the legacy <p>-harvest.
    assert.match(result?.content ?? "", /legacy\d+/);
    assert.match(result?.content ?? "", /fallback\d+/);
    // Declutter runs in the legacy path too, so the bio is still stripped.
    assert.doesNotMatch(result?.content ?? "", /senior writer at Example Magazine/);
    assert.doesNotMatch(result?.content ?? "", /By Jane Doe/);
  } finally {
    if (prev === undefined) delete process.env.SCRAPER_READABILITY;
    else process.env.SCRAPER_READABILITY = prev;
  }
});

test("extractArticle (clean capture): a long multi-paragraph article loses no body content", () => {
  // Guards the never-lose-content property: every paragraph of a normal raw
  // article must survive the Readability + declutter pipeline.
  const paragraphs = Array.from(
    { length: 6 },
    (_, i) => `<p>${wordBlock(25, `block${i}`)} sentence here.</p>`,
  );
  const html =
    "<html><head><title>Long Article</title></head><body><article>" +
    paragraphs.join("") +
    "</article></body></html>";

  const result = extractArticle(html, "https://unknown-news.example.com/article/long");
  assert.ok(result, "should extract the article");
  for (let i = 0; i < 6; i++) {
    assert.match(
      result?.content ?? "",
      new RegExp(`block${i}\\d+`),
      `paragraph ${i} must be preserved (no body loss)`,
    );
  }
});
