import { test } from "node:test";
import assert from "node:assert/strict";

import {
  analyzeArticles,
  parseArgs,
  selectFreshSmithsonianUrls,
  smithsonianDiscoveryLimit,
} from "../scripts/scrape-smithsonian";

test("smithsonian workflow CLI defaults to analyze without publishing", () => {
  assert.deepEqual(parseArgs([]), {
    limit: 50,
    visitedFile: ".scraper-state/smithsonian-visited-urls.json",
    includeVisited: false,
    targetSaved: false,
    untilExhausted: false,
    analyzeOnly: false,
    publish: false,
    help: false,
  });
});

test("smithsonian workflow CLI accepts publish and scrape controls", () => {
  const args = parseArgs([
    "--limit",
    "12",
    "--visited-file",
    ".scraper-state/custom.json",
    "--include-visited",
    "--target-saved",
    "--until-exhausted",
    "--analyze-only",
    "--publish",
    "--help",
  ]);

  assert.equal(args.limit, 12);
  assert.equal(args.visitedFile, ".scraper-state/custom.json");
  assert.equal(args.includeVisited, true);
  assert.equal(args.targetSaved, true);
  assert.equal(args.untilExhausted, true);
  assert.equal(args.analyzeOnly, true);
  assert.equal(args.publish, true);
  assert.equal(args.help, true);
});

test("smithsonian workflow CLI accepts --all alias for exhaustive discovery", () => {
  const args = parseArgs(["--all"]);

  assert.equal(args.untilExhausted, true);
});

test("smithsonian exhaustive selection skips visited URLs without applying batch limit", () => {
  const discovered = [
    "https://www.smithsonianmag.com/history/seen-180000001/",
    "https://www.smithsonianmag.com/history/fresh-one-180000002/",
    "https://www.smithsonianmag.com/history/fresh-two-180000003/",
  ];
  const selection = selectFreshSmithsonianUrls(
    discovered,
    new Set(["https://www.smithsonianmag.com/history/seen-180000001/"]),
    1,
    false,
    false,
    true,
  );

  assert.deepEqual(selection.freshUrls, discovered.slice(1));
  assert.equal(selection.skippedVisited, 1);
});

test("smithsonian exhaustive discovery requests unbounded configured provider crawl", () => {
  assert.equal(
    smithsonianDiscoveryLimit(50, 187, false, false, true),
    Number.POSITIVE_INFINITY,
  );
});

test("smithsonian analysis ignores article prose that mentions podcast subscription", () => {
  const findings = analyzeArticles([
    {
      title: "Transcript One",
      sourceUrl: "https://www.smithsonianmag.com/science-nature/transcript-one-180000001/",
      content:
        "<p>A transcript is below. To subscribe to “There’s More to That,” and to listen to past episodes about native bees, use your podcast app.</p>",
      wordCount: 80,
    },
    {
      title: "Transcript Two",
      sourceUrl: "https://www.smithsonianmag.com/science-nature/transcript-two-180000002/",
      content:
        "<p>This is an edited version of a conversation for a weekly podcast, with the transcript lightly condensed for clarity.</p>",
      wordCount: 75,
    },
  ]);

  assert.equal(findings.some((finding) => finding.key === "subscription"), false);
});

test("smithsonian analysis ignores ordinary prose containing popular and advertising terms", () => {
  const findings = analyzeArticles([
    {
      title: "History One",
      sourceUrl: "https://www.smithsonianmag.com/history/history-one-180000001/",
      content:
        "<p>The town's most popular establishment became a gathering place for residents.</p><p>Some families later secured photography and advertising contracts.</p>",
      wordCount: 90,
    },
    {
      title: "History Two",
      sourceUrl: "https://www.smithsonianmag.com/history/history-two-180000002/",
      content:
        "<p>One of the most popular historians in the field revisited the archive.</p><p>The poster credit named an advertising archive.</p>",
      wordCount: 95,
    },
  ]);

  assert.equal(findings.length, 0);
});

test("smithsonian analysis still flags repeated newsletter chrome", () => {
  const findings = analyzeArticles([
    {
      title: "Article One",
      sourceUrl: "https://www.smithsonianmag.com/history/article-one-180000001/",
      content: "<p>Sign up for our newsletter to get the latest stories.</p>",
      wordCount: 80,
    },
    {
      title: "Article Two",
      sourceUrl: "https://www.smithsonianmag.com/history/article-two-180000002/",
      content: "<p>Sign up for our newsletter to get the latest stories.</p>",
      wordCount: 75,
    },
  ]);

  const subscription = findings.find((finding) => finding.key === "subscription");
  assert.ok(subscription);
  assert.equal(subscription.affectedUrls.size, 2);
});
