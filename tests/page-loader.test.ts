/**
 * Tests for src/lib/reader/page-loader.ts — buildArticleJsonLd.
 *
 * Validates:
 * - Correct schema.org structure
 * - Optional fields omitted when absent
 * - Description truncation and whitespace normalization
 * - Author/publisher fallback logic
 */
process.env.LOG_LEVEL = "error";

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildArticleJsonLd } from "@/lib/reader/page-loader";

test("buildArticleJsonLd produces valid schema.org NewsArticle shape", () => {
  const article = {
    title: "Test Article",
    author: "Jane Doe",
    source: "ReadWise Blog",
    publishedAt: new Date("2026-03-15T10:00:00Z"),
    heroImage: "https://example.com/img.jpg",
  };
  const result = buildArticleJsonLd(article, "A short description");

  assert.equal(result["@context"], "https://schema.org");
  assert.equal(result["@type"], "NewsArticle");
  assert.equal(result.headline, "Test Article");
  assert.deepEqual(result.author, { "@type": "Person", name: "Jane Doe" });
  assert.deepEqual(result.publisher, { "@type": "Organization", name: "ReadWise Blog" });
  assert.equal(result.datePublished, "2026-03-15T10:00:00.000Z");
  assert.equal(result.image, "https://example.com/img.jpg");
});

test("buildArticleJsonLd omits optional fields when absent", () => {
  const article = {
    title: "Minimal",
    author: null,
    source: null,
    publishedAt: null,
    heroImage: null,
  };
  const result = buildArticleJsonLd(article, "desc");

  assert.equal(result.headline, "Minimal");
  assert.equal("author" in result, false);
  assert.deepEqual(result.publisher, { "@type": "Organization", name: "ReadWise" });
  assert.equal("datePublished" in result, false);
  assert.equal("image" in result, false);
});

test("buildArticleJsonLd truncates description to 200 chars", () => {
  const article = {
    title: "Long Desc",
    author: null,
    source: "Src",
    publishedAt: null,
    heroImage: null,
  };
  const longDesc = "A".repeat(300);
  const result = buildArticleJsonLd(article, longDesc);

  assert.equal(typeof result.description, "string");
  assert.ok((result.description as string).length <= 200);
});

test("buildArticleJsonLd normalizes whitespace in description", () => {
  const article = {
    title: "Whitespace",
    author: null,
    source: null,
    publishedAt: null,
    heroImage: null,
  };
  const result = buildArticleJsonLd(article, "  multiple   spaces\n\nnewlines  ");

  assert.equal(result.description, "multiple spaces newlines");
});
