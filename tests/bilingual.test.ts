/**
 * Tests for src/lib/bilingual.ts — pure functions, no DB or network.
 * Run via Node's built-in test runner (same harness as other project tests).
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

describe("bilingual helpers", async () => {
  test("splitHtmlParagraphs — splits on </p> boundaries", async () => {
    const { splitHtmlParagraphs } = await import("@/lib/bilingual");
    const html = "<p>First</p><p>Second</p><p>Third</p>";
    const result = splitHtmlParagraphs(html);
    assert.equal(result.length, 3);
    assert.equal(result[0], "<p>First</p>");
    assert.equal(result[1], "<p>Second</p>");
    assert.equal(result[2], "<p>Third</p>");
  });

  test("splitHtmlParagraphs — preserves headings as separate chunks", async () => {
    const { splitHtmlParagraphs } = await import("@/lib/bilingual");
    const html = "<h2>Title</h2><p>Body</p>";
    const result = splitHtmlParagraphs(html);
    assert.equal(result.length, 2);
    assert.match(result[0], /^<h2>/);
    assert.match(result[1], /^<p>/);
  });

  test("splitHtmlParagraphs — returns whole string when no block tags", async () => {
    const { splitHtmlParagraphs } = await import("@/lib/bilingual");
    const html = "Just some plain text";
    const result = splitHtmlParagraphs(html);
    assert.equal(result.length, 1);
    assert.equal(result[0], "Just some plain text");
  });

  test("splitHtmlParagraphs — filters empty chunks", async () => {
    const { splitHtmlParagraphs } = await import("@/lib/bilingual");
    const html = "<p>A</p>   \n  <p>B</p>";
    const result = splitHtmlParagraphs(html);
    assert.equal(result.length, 2);
  });

  test("splitTranslationParagraphs — splits on double newlines", async () => {
    const { splitTranslationParagraphs } = await import("@/lib/bilingual");
    const text = "Primera.\n\nSegunda.\n\nTercera.";
    const result = splitTranslationParagraphs(text);
    assert.equal(result.length, 3);
    assert.equal(result[0], "Primera.");
    assert.equal(result[1], "Segunda.");
    assert.equal(result[2], "Tercera.");
  });

  test("splitTranslationParagraphs — trims whitespace", async () => {
    const { splitTranslationParagraphs } = await import("@/lib/bilingual");
    const text = "  Hello.  \n\n  World.  ";
    const result = splitTranslationParagraphs(text);
    assert.equal(result.length, 2);
    assert.equal(result[0], "Hello.");
    assert.equal(result[1], "World.");
  });

  test("splitTranslationParagraphs — returns single paragraph with no double newline", async () => {
    const { splitTranslationParagraphs } = await import("@/lib/bilingual");
    const result = splitTranslationParagraphs("Only one paragraph.");
    assert.equal(result.length, 1);
    assert.equal(result[0], "Only one paragraph.");
  });

  test("alignParagraphs — 1:1 when counts match", async () => {
    const { alignParagraphs } = await import("@/lib/bilingual");
    const src = ["<p>A</p>", "<p>B</p>", "<p>C</p>"];
    const trans = ["AA", "BB", "CC"];
    const result = alignParagraphs(src, trans);
    assert.equal(result.length, 3);
    assert.equal(result[0].src, "<p>A</p>");
    assert.equal(result[0].trans, "AA");
    assert.equal(result[1].trans, "BB");
    assert.equal(result[2].trans, "CC");
  });

  test("alignParagraphs — null trans when translation is shorter", async () => {
    const { alignParagraphs } = await import("@/lib/bilingual");
    const src = ["<p>A</p>", "<p>B</p>", "<p>C</p>"];
    const trans = ["AA", "BB"]; // one short
    const result = alignParagraphs(src, trans);
    assert.equal(result.length, 3);
    assert.equal(result[0].trans, "AA");
    assert.equal(result[1].trans, "BB");
    assert.equal(result[2].trans, null); // no translation for last paragraph
  });

  test("alignParagraphs — discards extra translation paragraphs", async () => {
    const { alignParagraphs } = await import("@/lib/bilingual");
    const src = ["<p>A</p>"];
    const trans = ["AA", "BB", "CC"]; // more translation than source
    const result = alignParagraphs(src, trans);
    assert.equal(result.length, 1);
    assert.equal(result[0].trans, "AA");
  });

  test("alignParagraphs — empty source returns empty array", async () => {
    const { alignParagraphs } = await import("@/lib/bilingual");
    const result = alignParagraphs([], ["AA"]);
    assert.equal(result.length, 0);
  });

  test("alignParagraphs — all null trans when translation array is empty", async () => {
    const { alignParagraphs } = await import("@/lib/bilingual");
    const result = alignParagraphs(["<p>A</p>", "<p>B</p>"], []);
    assert.equal(result.length, 2);
    assert.equal(result[0].trans, null);
    assert.equal(result[1].trans, null);
  });
});
