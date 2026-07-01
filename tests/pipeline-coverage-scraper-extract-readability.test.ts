process.env.LOG_LEVEL = "error";

import { before, mock, test } from "node:test";
import assert from "node:assert/strict";

function words(count: number, prefix = "readable"): string {
  return Array.from({ length: count }, (_, index) => `${prefix}${index}`).join(" ");
}

let readableResult: {
  contentHtml: string;
  wordCount: number;
  byline?: string | null;
  excerpt?: string | null;
} | null = null;

before(() => {
  mock.module("@/lib/runtime-config/scraper", {
    namedExports: {
      scraperHtmlNormalize: () => false,
      scraperReadability: () => true,
    },
  });
  mock.module("@/lib/scraper/readability-extract", {
    namedExports: {
      extractReadable: () => readableResult,
    },
  });
});

test("extractArticle prefers a comparable Readability body when legacy is not over-trimmed", async () => {
  const { extractArticle } = await import("@/lib/scraper/extract");
  readableResult = {
    contentHtml: `<p>${words(70, "clean")}</p>`,
    wordCount: 70,
    byline: "Readable Byline",
    excerpt: "Readable excerpt",
  };
  const html = `<html><head><title>Readable Story</title></head><body><article><p>${words(65, "legacy")}</p></article></body></html>`;

  const article = extractArticle(html, "https://example.com/readable");

  assert.ok(article);
  assert.match(article.content, /clean0/);
  assert.equal(article.author, "Readable Byline");
  assert.equal(article.excerpt, "Readable excerpt");
});

test("extractArticle recovers Readability images when JSON-LD body has comparable text", async () => {
  const { extractArticle } = await import("@/lib/scraper/extract");
  readableResult = {
    contentHtml: `<p>${words(75, "imagebody")}</p><figure><img src="https://example.com/photo.jpg"></figure>`,
    wordCount: 75,
  };
  const html = `
    <script type="application/ld+json">
      {
        "@type": "NewsArticle",
        "headline": "Image Recovery",
        "articleBody": "${words(75, "jsonld")}"
      }
    </script>
  `;

  const article = extractArticle(html, "https://example.com/image");

  assert.ok(article);
  assert.match(article.content, /photo\.jpg/);
});

test("extractArticle rejects bodies below the minimum word count after cleanup", async () => {
  const { extractArticle } = await import("@/lib/scraper/extract");
  readableResult = null;

  assert.equal(
    extractArticle("<html><head><title>Short</title></head><body><article><p>Too short.</p></article></body></html>", "https://example.com/short"),
    null,
  );
});
