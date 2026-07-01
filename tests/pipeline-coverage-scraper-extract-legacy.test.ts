process.env.LOG_LEVEL = "error";

import { before, mock, test } from "node:test";
import assert from "node:assert/strict";

function words(count: number): string {
  return Array.from({ length: count }, (_, index) => `legacy${index}`).join(" ");
}

before(() => {
  mock.module("linkedom", {
    namedExports: {
      parseHTML: () => {
        throw new Error("parse failed");
      },
    },
  });
  mock.module("@/lib/runtime-config/scraper", {
    namedExports: {
      scraperHtmlNormalize: () => false,
      scraperReadability: () => false,
    },
  });
});

test("extractArticle falls back to legacy paragraph harvesting when DOM parsing fails", async () => {
  const { extractArticle } = await import("@/lib/scraper/extract");
  const html = `
    <html>
      <head><title>Legacy Harvest</title></head>
      <body>
        <article>
          <p>${words(60)}</p>
          <p>   </p>
        </article>
      </body>
    </html>
  `;

  const article = extractArticle(html, "https://example.com/legacy");

  assert.ok(article);
  assert.match(article.content, /legacy0/);
});
