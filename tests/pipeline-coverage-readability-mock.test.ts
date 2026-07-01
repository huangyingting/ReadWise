process.env.LOG_LEVEL = "error";

import { test, before, mock } from "node:test";
import assert from "node:assert/strict";

let shouldThrow = false;
let parsedArticle: unknown = null;

before(() => {
  mock.module("@mozilla/readability", {
    namedExports: {
      Readability: class {
        parse() {
          if (shouldThrow) throw new Error("readability failed");
          return parsedArticle;
        }
      },
    },
  });
});

test("extractReadable accepts content without Readability's wrapper", async () => {
  const { extractReadable } = await import("@/lib/scraper/readability-extract");
  parsedArticle = {
    title: "  Wrapperless Article  ",
    byline: "   ",
    excerpt: undefined,
    lang: " en ",
    siteName: null,
    content: "  <p>Wrapperless article body.</p>  ",
    textContent: "word ".repeat(55),
  };

  const result = extractReadable("<html><head></head><body></body></html>", "https://example.com/a");

  assert.ok(result);
  assert.equal(result.title, "Wrapperless Article");
  assert.equal(result.byline, null);
  assert.equal(result.contentHtml, "<p>Wrapperless article body.</p>");
  assert.equal(result.lang, "en");
});

test("extractReadable returns null when Readability throws", async () => {
  const { extractReadable } = await import("@/lib/scraper/readability-extract");
  shouldThrow = true;

  assert.equal(extractReadable("<html><body><article></article></body></html>", "https://example.com/a"), null);
});
