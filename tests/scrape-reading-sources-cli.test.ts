process.env.LOG_LEVEL = "error";

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  READING_SOURCE_PROVIDER_KEYS,
  parseArgs,
  readingSourceDiscoveryLimit,
  selectFreshReadingSourceUrls,
} from "../scripts/scrape-reading-sources";

test("reading-source workflow defaults to discover-only URL-list generation", () => {
  assert.deepEqual(parseArgs([]), {
    providers: [...READING_SOURCE_PROVIDER_KEYS],
    limit: 100,
    concurrency: 2,
    outDir: ".scraper-state/reading-sources",
    includeExisting: false,
    untilExhausted: false,
    targetSaved: false,
    scrape: false,
    writeUrls: true,
    help: false,
  });
});

test("reading-source workflow parses provider controls and explicit scrape mode", () => {
  const args = parseArgs([
    "--provider",
    "atlasobscura,jstordaily",
    "--provider",
    "yalee360",
    "--limit",
    "25",
    "--concurrency",
    "4",
    "--out-dir",
    ".scraper-state/custom-reading",
    "--include-existing",
    "--target-saved",
    "--scrape",
    "--write-urls",
  ]);

  assert.deepEqual(args.providers, ["atlasobscura", "jstordaily", "yalee360"]);
  assert.equal(args.limit, 25);
  assert.equal(args.concurrency, 4);
  assert.equal(args.outDir, ".scraper-state/custom-reading");
  assert.equal(args.includeExisting, true);
  assert.equal(args.targetSaved, true);
  assert.equal(args.scrape, true);
  assert.equal(args.writeUrls, true);
});

test("reading-source workflow lets --discover-only override --scrape", () => {
  const args = parseArgs(["--scrape", "--discover-only"]);

  assert.equal(args.scrape, false);
  assert.equal(args.writeUrls, true);
});

test("reading-source discovery limit broadens target-saved runs and unbounds exhaustive runs", () => {
  assert.equal(readingSourceDiscoveryLimit({ limit: 20, targetSaved: false, untilExhausted: false }), 20);
  assert.equal(readingSourceDiscoveryLimit({ limit: 20, targetSaved: true, untilExhausted: false }), 200);
  assert.equal(
    readingSourceDiscoveryLimit({ limit: 20, targetSaved: true, untilExhausted: true }),
    Number.POSITIVE_INFINITY,
  );
});

test("reading-source fresh selection skips existing URLs unless requested", () => {
  const discovered = ["https://example.test/a", "https://example.test/b", "https://example.test/c"];
  const existing = new Set(["https://example.test/a"]);

  assert.deepEqual(
    selectFreshReadingSourceUrls(discovered, existing, 1, false, false, false),
    { freshUrls: ["https://example.test/b"], skippedExisting: 1 },
  );
  assert.deepEqual(
    selectFreshReadingSourceUrls(discovered, existing, 1, true, false, false),
    { freshUrls: ["https://example.test/a"], skippedExisting: 0 },
  );
  assert.deepEqual(
    selectFreshReadingSourceUrls(discovered, existing, 1, false, true, false),
    { freshUrls: ["https://example.test/b", "https://example.test/c"], skippedExisting: 1 },
  );
});
