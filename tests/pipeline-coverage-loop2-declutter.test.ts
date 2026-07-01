process.env.LOG_LEVEL = "error";

import { test } from "node:test";
import assert from "node:assert/strict";

import { declutterArticleHtml } from "@/lib/scraper/declutter";

const body = Array.from({ length: 90 }, (_, i) => `article word ${i}`).join(" ");

test("declutterArticleHtml removes Technology Review newsletter and TikTok residue", () => {
  const html = [
    `<p>This story originally appeared in The Algorithm, our weekly newsletter. Sign up for more.</p>`,
    `<blockquote><a href="not a url">@ignored</a></blockquote>`,
    `<blockquote><a href="https://www.tiktok.com/@readwise">@readwise</a></blockquote>`,
    `<p>${body}</p>`,
  ].join("");

  const out = declutterArticleHtml(html, { providerKey: "technologyreview" });

  assert.ok(!out.includes("Algorithm"));
  assert.ok(!out.includes("tiktok.com"));
  assert.ok(out.includes("article word 89"));
});

test("declutterArticleHtml removes leading author and matching ISO date lines", () => {
  const html = [
    "<p>Jane Doe</p>",
    "<p>2026-07-01</p>",
    `<p>${body}</p>`,
  ].join("");

  const out = declutterArticleHtml(html, {
    authorName: "Jane Doe",
    publishedAt: new Date("2026-07-01T12:00:00Z"),
  });

  assert.ok(!out.includes("Jane Doe"));
  assert.ok(!out.includes("2026-07-01"));
  assert.ok(out.includes("article word 89"));
});

test("declutterArticleHtml removes leading byline prefixes and author bios", () => {
  const html = [
    "<p>By Jane Doe. Jane is a senior writer at Example.</p>",
    "<p>Jane Doe is a reporter at Example Magazine.</p>",
    `<p>${body}</p>`,
  ].join("");

  const out = declutterArticleHtml(html, { authorName: "Jane Doe" });

  assert.ok(!out.includes("senior writer"));
  assert.ok(!out.includes("reporter at Example"));
  assert.ok(out.includes("article word 89"));
});

test("declutterArticleHtml applies Smithsonian author-line cleanup", () => {
  const html = [
    "<p>Jane Doe, reporter</p>",
    `<p>${body}</p>`,
  ].join("");

  const out = declutterArticleHtml(html, {
    providerKey: "smithsonian",
    authorName: "Jane Doe",
  });

  assert.ok(!out.includes("Jane Doe, reporter"));
  assert.ok(out.includes("article word 89"));
});

test("declutterArticleHtml removes trailing medium-confidence bylines", () => {
  const html = [
    `<p>${body}</p>`,
    "<p>By Taylor Reed. Taylor is a senior writer at Example.</p>",
  ].join("");

  const out = declutterArticleHtml(html);

  assert.ok(!out.includes("Taylor Reed"));
  assert.ok(out.includes("article word 89"));
});
