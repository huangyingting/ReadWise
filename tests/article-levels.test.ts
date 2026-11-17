/**
 * Unit tests for article reading levels (#1303): client-safe helpers, variant
 * text helpers, the `?level=` parser, and AI adaptation output parsing.
 */
process.env.LOG_LEVEL = "error";

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ARTICLE_LEVEL_KEYS,
  ORIGINAL_LEVEL,
  READING_LEVEL_KEYS,
  isArticleLevelKey,
  isReadingLevelKey,
  levelQuery,
  parseReadingLevel,
  readerLevelHref,
  readingLevelLabel,
  readingLevelRank,
} from "@/lib/article-levels/levels";
import { paragraphsToHtml, textToParagraphs, variantContentToText } from "@/lib/article-levels/variants";
import { parseLevelParam, levelQuery as levelQueryParser } from "@/lib/article-levels/http";

test("level keys, guards, and parsing", () => {
  assert.deepEqual(ARTICLE_LEVEL_KEYS, ["A2", "B1", "B2", "C1"]);
  assert.deepEqual(READING_LEVEL_KEYS, ["A2", "B1", "B2", "C1", "original"]);
  assert.equal(isArticleLevelKey("B1"), true);
  assert.equal(isArticleLevelKey("original"), false);
  assert.equal(isArticleLevelKey(3), false);
  assert.equal(isReadingLevelKey("original"), true);
  assert.equal(isReadingLevelKey("C2"), false);
  assert.equal(parseReadingLevel("B2"), "B2");
  assert.equal(parseReadingLevel("nope"), ORIGINAL_LEVEL);
  assert.equal(parseReadingLevel(undefined), ORIGINAL_LEVEL);
});

test("labels, hrefs, query suffixes, and ranking", () => {
  assert.equal(readingLevelLabel("original"), "Original");
  assert.equal(readingLevelLabel("B1"), "B1 · ~850L");
  assert.equal(readingLevelLabel("A2", 620), "A2 · ~620L");
  assert.equal(readerLevelHref("a 1", "original"), "/reader/a%201");
  assert.equal(readerLevelHref("a1", "C1"), "/reader/a1?level=C1");
  assert.equal(levelQuery("original"), "");
  assert.equal(levelQuery("B2"), "?level=B2");
  assert.equal(levelQuery("B2", "&"), "&level=B2");
  assert.deepEqual(
    [...READING_LEVEL_KEYS].reverse().sort((a, b) => readingLevelRank(a) - readingLevelRank(b)),
    ["A2", "B1", "B2", "C1", "original"],
  );
});

test("variant text round-trips through escaped paragraphs", () => {
  const text = "  First  line <b>bold</b> & \"quoted\".\n\n\n Second\nparagraph. \n\n   ";
  const paragraphs = textToParagraphs(text);
  assert.deepEqual(paragraphs, ['First line <b>bold</b> & "quoted".', "Second paragraph."]);
  const html = paragraphsToHtml(paragraphs);
  assert.equal(html, "<p>First line &lt;b&gt;bold&lt;/b&gt; &amp; &quot;quoted&quot;.</p>\n<p>Second paragraph.</p>");
  assert.equal(variantContentToText(html), 'First line <b>bold</b> & "quoted".\n\nSecond paragraph.');
  assert.deepEqual(textToParagraphs("   \n\n  "), []);
});

test("the ?level= parser accepts known levels and rejects unknown ones", () => {
  assert.deepEqual(parseLevelParam(new URLSearchParams()), { ok: true, value: "original" });
  assert.deepEqual(parseLevelParam(new URLSearchParams("level=")), { ok: true, value: "original" });
  assert.deepEqual(parseLevelParam(new URLSearchParams("level=B1")), { ok: true, value: "B1" });
  assert.equal(parseLevelParam(new URLSearchParams("level=Z9")).ok, false);
  assert.deepEqual(levelQueryParser(new URLSearchParams("level=C1")), { ok: true, value: { level: "C1" } });
  assert.equal(levelQueryParser(new URLSearchParams("level=bad")).ok, false);
});
