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
