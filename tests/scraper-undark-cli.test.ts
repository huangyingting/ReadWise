import { test } from "node:test";
import assert from "node:assert/strict";

import {
  accountedUndarkUrlSet,
  analyzeArticles,
  parseArgs,
  selectFreshUndarkUrls,
  shouldRetryUndarkHeadless,
  undarkDiscoveryLimit,
} from "../scripts/scrape-undark";

test("undark workflow CLI defaults to published exhaustive-ready batches", () => {
  assert.deepEqual(parseArgs([]), {
    limit: 100,
    concurrency: 3,
    visitedFile: ".scraper-state/undark-visited-urls.json",
    includeVisited: false,
    targetSaved: false,
    untilExhausted: false,
    analyzeOnly: false,
    headless: "off",
    publish: true,
    help: false,
  });
});

test("undark workflow CLI accepts scrape controls and draft override", () => {
  const args = parseArgs([
    "--limit",
    "12",
    "--concurrency",
    "2",
    "--visited-file",
    ".scraper-state/custom-undark.json",
    "--include-visited",
    "--target-saved",
    "--until-exhausted",
    "--analyze-only",
    "--headless",
    "--draft",
    "--help",
  ]);

  assert.equal(args.limit, 12);
  assert.equal(args.concurrency, 2);
  assert.equal(args.visitedFile, ".scraper-state/custom-undark.json");
  assert.equal(args.includeVisited, true);
  assert.equal(args.targetSaved, true);
  assert.equal(args.untilExhausted, true);
  assert.equal(args.analyzeOnly, true);
  assert.equal(args.headless, "fallback");
  assert.equal(args.publish, false);
  assert.equal(args.help, true);
});

test("undark workflow CLI accepts headless-only mode", () => {
  const args = parseArgs(["--headless-only"]);

  assert.equal(args.headless, "force");
});

test("undark workflow CLI accepts --all alias for exhaustive discovery", () => {
  const args = parseArgs(["--all"]);

  assert.equal(args.untilExhausted, true);
});

test("undark headless fallback only retries static extraction failures", () => {
  assert.equal(
    shouldRetryUndarkHeadless({
      status: "failed",
      reason: "could not extract article content",
      sourceUrl: "https://undark.org/2026/06/24/story/",
    }),
    true,
  );
  assert.equal(
    shouldRetryUndarkHeadless({
      status: "failed",
      reason: "content quality check failed (score=10)",
      sourceUrl: "https://undark.org/2026/06/24/story/",
    }),
    true,
  );
  assert.equal(
    shouldRetryUndarkHeadless({
      status: "failed",
      reason: "bot challenge not bypassed for undark.org",
      sourceUrl: "https://undark.org/2026/06/24/story/",
    }),
    true,
  );
  assert.equal(
    shouldRetryUndarkHeadless({
      status: "failed",
      reason: "unexpected db failure",
      sourceUrl: "https://undark.org/2026/06/24/story/",
    }),
    false,
  );
  assert.equal(
    shouldRetryUndarkHeadless({
      status: "skipped",
      reason: "duplicate sourceUrl",
      sourceUrl: "https://undark.org/2026/06/24/story/",
    }),
    false,
  );
});


test("undark exhaustive selection skips accounted URLs without applying batch limit", () => {
  const discovered = [
    "https://undark.org/2026/06/24/seen-story/",
    "https://undark.org/2026/06/25/fresh-one/",
    "https://undark.org/2026/06/26/fresh-two/",
  ];
  const selection = selectFreshUndarkUrls(
    discovered,
    new Set(["https://undark.org/2026/06/24/seen-story/"]),
    1,
    false,
    false,
    true,
  );

  assert.deepEqual(selection.freshUrls, discovered.slice(1));
  assert.equal(selection.skippedSeen, 1);
});

test("undark accounted URL set keeps failed URLs retryable", () => {
  const accounted = accountedUndarkUrlSet([
    {
      url: "https://undark.org/2026/06/24/saved-story/",
      lastOutcome: "saved",
    },
    {
      url: "https://undark.org/2026/06/25/duplicate-story/",
      lastOutcome: "duplicate",
    },
    {
      url: "https://undark.org/2026/06/26/failed-story/",
      lastOutcome: "failed",
    },
  ]);

  assert.equal(accounted.has("https://undark.org/2026/06/24/saved-story/"), true);
  assert.equal(accounted.has("https://undark.org/2026/06/25/duplicate-story/"), true);
  assert.equal(accounted.has("https://undark.org/2026/06/26/failed-story/"), false);
});

test("undark exhaustive discovery requests unbounded configured provider crawl", () => {
  assert.equal(
    undarkDiscoveryLimit(100, 3267, false, false, true),
    Number.POSITIVE_INFINITY,
  );
});

test("undark analysis ignores ordinary prose with newsletter and support words", () => {
  const findings = analyzeArticles([
    {
      title: "Policy One",
      sourceUrl: "https://undark.org/2026/06/24/policy-one/",
      content:
        "<p>The researcher said public support mattered for the project and described a local newsletter as an archive.</p>",
      wordCount: 80,
    },
    {
      title: "Policy Two",
      sourceUrl: "https://undark.org/2026/06/25/policy-two/",
      content:
        "<p>Community members support the new clinic, which publishes a newsletter about study results.</p>",
      wordCount: 75,
    },
  ]);

  assert.equal(findings.length, 0);
});

test("undark analysis flags recurring support CTA chrome", () => {
  const findings = analyzeArticles([
    {
      title: "Article One",
      sourceUrl: "https://undark.org/2026/06/24/article-one/",
      content:
        "<p>Undark is a non-profit, editorially independent magazine. Please help support our journalism.</p>",
      wordCount: 80,
    },
    {
      title: "Article Two",
      sourceUrl: "https://undark.org/2026/06/25/article-two/",
      content:
        "<p>Undark is a non-profit, editorially independent magazine. Please help support our journalism.</p>",
      wordCount: 75,
    },
  ]);

  const support = findings.find((finding) => finding.key === "support");
  assert.ok(support);
  assert.equal(support.affectedUrls.size, 2);
});
