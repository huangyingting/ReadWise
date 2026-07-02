process.env.LOG_LEVEL = "error";

import { test, before, mock } from "node:test";
import assert from "node:assert/strict";

before(() => {
  mock.module("linkedom", {
    namedExports: {
      parseHTML: () => {
        throw new Error("parser unavailable");
      },
    },
  });
});

test("provider cleanup preserves HTML when link href parsing fails", async () => {
  const { applyProviderCleanup } = await import("@/lib/scraper/cleanup");
  const html = '<p><a href="https://example.com/promo">Cover</a></p>';

  assert.equal(applyProviderCleanup(html, { dropLinkHrefKeywords: ["promo"] }), html);
});

test("provider cleanup preserves HTML when text keyword parsing fails", async () => {
  const { applyProviderCleanup } = await import("@/lib/scraper/cleanup");
  const html = "<p>Provider signup copy.</p>";

  assert.equal(applyProviderCleanup(html, { dropTextKeywords: ["signup"] }), html);
});

test("provider cleanup preserves HTML when figcaption parsing fails", async () => {
  const { applyProviderCleanup } = await import("@/lib/scraper/cleanup");
  const html = "<figure><img src=\"photo.jpg\"><figcaption>Credit</figcaption></figure>";

  assert.equal(applyProviderCleanup(html, { dropFigcaptions: true }), html);
});
