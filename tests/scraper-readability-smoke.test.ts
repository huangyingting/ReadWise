/**
 * Smoke test: linkedom + @mozilla/readability load and work under node:test.
 *
 * Proves that the two dependencies introduced in the scraper-deps-foundation
 * PR can be imported and produce meaningful output before any feature code
 * depends on them.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { Readability } from "@mozilla/readability";

const ARTICLE_HTML = `<!DOCTYPE html>
<html>
  <head><title>The Art of Deep Reading</title></head>
  <body>
    <article>
      <h1>The Art of Deep Reading</h1>
      <p>Deep reading is a practice that trains focus and builds comprehension far beyond
      surface-level skimming. Unlike passive consumption, deep reading engages the
      reader in active synthesis of ideas.</p>
      <p>Studies in cognitive science show that sustained reading of long-form text
      strengthens neural pathways associated with empathy, critical thinking, and
      sustained attention. These benefits are measurable even after short daily sessions.</p>
      <p>Practitioners recommend starting with twenty minutes of uninterrupted reading,
      gradually increasing the duration as focus capacity grows. The key is consistency
      over intensity.</p>
    </article>
  </body>
</html>`;

test("linkedom parses HTML and Readability extracts title", () => {
  const { document } = parseHTML(ARTICLE_HTML);
  const result = new Readability(document as unknown as Document).parse();

  assert.ok(result !== null, "Readability.parse() must return an object");
  const title = result!.title ?? "";
  assert.ok(
    title.length > 0,
    `title must be non-empty, got: ${JSON.stringify(title)}`,
  );
  assert.match(title, /Deep Reading/i, "title should contain the article headline");
});

test("Readability extracts article body content", () => {
  const { document } = parseHTML(ARTICLE_HTML);
  const result = new Readability(document as unknown as Document).parse();

  assert.ok(result !== null, "Readability.parse() must return an object");
  const content = result!.content ?? "";
  assert.ok(content.length > 0, "content must be non-empty");
  assert.ok(
    content.toLowerCase().includes("deep reading"),
    "content should contain body text from the article",
  );
  assert.ok(
    content.includes("cognitive science"),
    "content should preserve paragraph text about cognitive science",
  );
});

test("Readability textContent strips HTML tags", () => {
  const { document } = parseHTML(ARTICLE_HTML);
  const result = new Readability(document as unknown as Document).parse();

  assert.ok(result !== null, "Readability.parse() must return an object");
  const textContent = result!.textContent ?? "";
  assert.ok(textContent.length > 0, "textContent must be non-empty");
  assert.doesNotMatch(
    textContent,
    /<[a-z]/i,
    "textContent must not contain raw HTML tags",
  );
});
