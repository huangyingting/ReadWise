/**
 * Unit tests for the scraper declutter pass.
 *
 * The declutter pass runs on already-extracted article HTML and removes the
 * residual boilerplate that a generic extractor (Readability / @extractus)
 * leaves behind — above all the trailing author byline/bio paragraph, plus
 * related/newsletter/share/comments widgets and high-link-density noise.
 *
 * linkedom provides the DOM, so no browser globals are required here.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { declutterArticleHtml } from "@/lib/scraper/declutter";

/** Three substantial body paragraphs that must always survive decluttering. */
const BODY = [
  `<p>Deep reading is a practice that trains focus and builds comprehension far beyond surface-level skimming and the passive consumption of media.</p>`,
  `<p>Cognitive science shows that sustained reading of long-form text strengthens neural pathways associated with empathy and critical thinking over time.</p>`,
  `<p>Practitioners recommend starting with twenty minutes of uninterrupted reading and gradually increasing the duration as focus capacity grows steadily.</p>`,
].join("\n");

function assertBodyIntact(out: string): void {
  assert.ok(out.includes("Deep reading is a practice"), "first body paragraph kept");
  assert.ok(out.includes("Cognitive science"), "second body paragraph kept");
  assert.ok(out.includes("Practitioners recommend"), "third body paragraph kept");
}

test("removes a trailing author byline/bio paragraph (pattern path)", () => {
  const html =
    BODY +
    `\n<p>By Jane Doe. Jane is a senior writer at Example covering science. Follow @jane.</p>`;
  const out = declutterArticleHtml(html);

  assert.ok(!out.includes("Jane Doe"), "byline paragraph removed");
  assert.ok(!out.includes("senior writer"), "bio sentence removed");
  assertBodyIntact(out);
});

test("removes a trailing byline using the byline name hint", () => {
  // No leading "By", so only the name hint can identify this as the author block.
  const html =
    BODY + `\n<p>Jane Doe reports on science and society from Berlin.</p>`;
  const out = declutterArticleHtml(html, { byline: "Jane Doe" });

  assert.ok(!out.includes("Jane Doe"), "hinted byline removed");
  assertBodyIntact(out);
});

test("authorName hint is honored as an alias of byline", () => {
  const html = BODY + `\n<p>Jane Doe is a reporter based in Berlin.</p>`;
  const out = declutterArticleHtml(html, { authorName: "Jane Doe" });

  assert.ok(!out.includes("Jane Doe"), "authorName-hinted byline removed");
  assertBodyIntact(out);
});

test("removes a 'Related' link-list section", () => {
  const html =
    BODY +
    `<aside class="related"><h3>Related</h3><ul>` +
    `<li><a href="/a">A study on attention</a></li>` +
    `<li><a href="/b">Why we skim</a></li>` +
    `</ul></aside>`;
  const out = declutterArticleHtml(html);

  assert.ok(!out.includes("Related"), "related heading removed");
  assert.ok(!out.includes("A study on attention"), "related links removed");
  assertBodyIntact(out);
});

test("removes a 'more from' label widget even without a boilerplate class", () => {
  const html =
    BODY +
    `<div><h2>More from the magazine</h2><ul>` +
    `<li><a href="/x">Essay one</a></li>` +
    `<li><a href="/y">Essay two</a></li></ul></div>`;
  const out = declutterArticleHtml(html);

  assert.ok(!out.includes("More from"), "label heading removed");
  assert.ok(!out.includes("Essay one"), "trailing link list removed");
  assertBodyIntact(out);
});

test("removes a newsletter / subscribe CTA block", () => {
  const html =
    BODY +
    `<div class="newsletter-cta"><p>Subscribe to our weekly newsletter for more stories like this.</p></div>`;
  const out = declutterArticleHtml(html);

  assert.ok(!out.includes("Subscribe"), "newsletter CTA removed");
  assertBodyIntact(out);
});

test("removes a share / social buttons block", () => {
  const html =
    BODY +
    `<div class="social share"><a href="#">Share on X</a><a href="#">Share on Facebook</a></div>`;
  const out = declutterArticleHtml(html);

  assert.ok(!out.includes("Share on X"), "share block removed");
  assertBodyIntact(out);
});

test("removes a high-link-density list but keeps a paragraph with one link", () => {
  const html =
    `<p>You can read the full underlying study <a href="/study">here</a> for a detailed look at the methods used.</p>` +
    BODY +
    `<ul>` +
    `<li><a href="/1">Story one headline goes here</a></li>` +
    `<li><a href="/2">Story two headline goes here</a></li>` +
    `<li><a href="/3">Story three headline goes here</a></li>` +
    `</ul>`;
  const out = declutterArticleHtml(html);

  assert.ok(!out.includes("Story one headline"), "link-dense list removed");
  assert.ok(out.includes("full underlying study"), "single-link paragraph kept");
  assert.ok(out.includes('href="/study"'), "the legitimate inline link is kept");
  assertBodyIntact(out);
});

test("keeps a legitimate mid-article paragraph that merely contains 'by'", () => {
  const html =
    `<p>The manuscript was written by hand over many years before printing presses existed widely in europe.</p>` +
    BODY +
    `<p>By Jane Doe. Jane is a staff writer at Example.</p>`;
  const out = declutterArticleHtml(html);

  assert.ok(out.includes("written by hand"), "mid-article 'by' paragraph kept");
  assert.ok(!out.includes("Jane Doe"), "actual trailing byline still removed");
  assertBodyIntact(out);
});

test("conservative guard: a short byline-like article is not gutted", () => {
  const html = `<p>By Jane Doe</p>`;
  const out = declutterArticleHtml(html, { byline: "Jane Doe" });

  assert.ok(out.trim().length > 0, "short byline-only article is not emptied");
  assert.ok(out.includes("Jane Doe"), "content preserved when removal would gut it");
});

test("is idempotent: declutter(declutter(x)) === declutter(x)", () => {
  const html =
    BODY +
    `<aside class="related"><h3>Related</h3><ul><li><a href="/a">A</a></li><li><a href="/b">B</a></li></ul></aside>` +
    `<p>By Jane Doe. Jane is a senior writer at Example. Follow @jane.</p>`;
  const once = declutterArticleHtml(html);
  const twice = declutterArticleHtml(once);

  assert.equal(twice, once, "second pass produces identical output");
});

test("returns empty / whitespace-only input unchanged", () => {
  assert.equal(declutterArticleHtml(""), "");
  assert.equal(declutterArticleHtml("   "), "   ");
});

test("does not throw on garbage input and returns a string", () => {
  assert.doesNotThrow(() => declutterArticleHtml("<<>not real html"));
  const out = declutterArticleHtml("<<>not real html");
  assert.equal(typeof out, "string");
  assert.ok(out.includes("not real html"), "text content is preserved");
});
