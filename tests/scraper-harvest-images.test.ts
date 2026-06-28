/**
 * Tests for the image-aware legacy harvest (Part A of the image-loss fix).
 *
 * The legacy body harvest used to collect `<p>` inner text only, so on the
 * providers where Readability under-performs and the harvest wins (BBC, NBC,
 * Knowable, …) every `<img>` was dropped. The harvest is now DOM-based
 * (linkedom): it walks content-bearing elements in document order, keeps
 * `<figure>`/`<img>`, resolves each `src` to an absolute URL, and drops only
 * site chrome (logos, sprites, tracking pixels, lazy-load placeholders).
 *
 * `SCRAPER_READABILITY=false` forces the legacy harvest path deterministically
 * (mirroring the existing legacy-path test in scraper.test.ts). All fixtures
 * are inline — no network or DB is touched.
 */
process.env.LOG_LEVEL = "error";

import { test } from "node:test";
import assert from "node:assert/strict";
import { extractArticle } from "@/lib/scraper/extract";

/** Builds a unique-word block so assertions can target the real body. */
function wordBlock(n: number, seed: string): string {
  return Array.from({ length: n }, (_, i) => `${seed}${i + 1}`).join(" ");
}

const ARTICLE_URL = "https://oceanwatch.example.com/news/right-whales-2026";

/**
 * Runs `fn` with the legacy (`<p>`-harvest) path forced on, restoring the
 * previous `SCRAPER_READABILITY` value afterwards.
 */
function withLegacyHarvest(fn: () => void): void {
  const prev = process.env.SCRAPER_READABILITY;
  process.env.SCRAPER_READABILITY = "false";
  try {
    fn();
  } finally {
    if (prev === undefined) delete process.env.SCRAPER_READABILITY;
    else process.env.SCRAPER_READABILITY = prev;
  }
}

test("legacy harvest keeps a content <img> (absolute src) and drops logo/placeholder chrome", () => {
  const html =
    "<!doctype html><html><head><title>Right Whales Slow Down for Speed Limits</title>" +
    '<meta name="author" content="Sam Rivers"></head><body>' +
    '<header><img src="/assets/logo.svg" alt="OceanWatch logo"></header>' +
    "<article>" +
    `<p>${wordBlock(40, "intro")} and the whales surfaced.</p>` +
    '<figure><img src="/images/right-whale-breach.jpg" alt="A right whale breaching off Cape Cod">' +
    "<figcaption>A right whale breaches off Cape Cod.</figcaption></figure>" +
    `<p>${wordBlock(40, "body")} migrating north each spring.</p>` +
    '<img src="/static/placeholder_img.jpg" alt="">' +
    `<p>${wordBlock(40, "tail")} before winter returns.</p>` +
    "</article></body></html>";

  withLegacyHarvest(() => {
    const result = extractArticle(html, ARTICLE_URL);
    assert.ok(result, "article should extract via the legacy harvest path");
    const content = result!.content;

    // Content image preserved with an ABSOLUTE https src (relative -> absolute).
    assert.match(
      content,
      /<img[^>]*\bsrc=["']https:\/\/oceanwatch\.example\.com\/images\/right-whale-breach\.jpg["']/i,
      "content image must be kept with an absolute src",
    );
    // Its descriptive caption survives too.
    assert.match(content, /breaches off Cape Cod/i, "figure caption should be preserved");

    // Site chrome images are gone.
    assert.doesNotMatch(content, /logo\.svg/i, "logo.svg chrome image must be dropped");
    assert.doesNotMatch(content, /placeholder/i, "placeholder chrome image must be dropped");

    // Body prose is fully preserved.
    assert.match(content, /intro1\b/, "intro paragraph kept");
    assert.match(content, /body1\b/, "middle paragraph kept");
    assert.match(content, /tail1\b/, "final paragraph kept");
  });
});

test("legacy harvest resolves a lazy-loaded image from data-src to an absolute URL", () => {
  const html =
    "<!doctype html><html><head><title>Lazy Loaded Imagery in the Deep Sea</title></head><body>" +
    "<article>" +
    `<p>${wordBlock(45, "deep")} far below the surface.</p>` +
    '<figure><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" ' +
    'data-src="/media/anglerfish.jpg" alt="An anglerfish lit by its lure"></figure>' +
    `<p>${wordBlock(45, "sea")} where light never reaches.</p>` +
    "</article></body></html>";

  withLegacyHarvest(() => {
    const result = extractArticle(html, "https://oceanwatch.example.com/news/anglerfish-2026");
    assert.ok(result, "article should extract");
    const content = result!.content;

    // The real image (data-src) is promoted to an absolute src...
    assert.match(
      content,
      /<img[^>]*\bsrc=["']https:\/\/oceanwatch\.example\.com\/media\/anglerfish\.jpg["']/i,
      "lazy image should resolve to its absolute data-src URL",
    );
    // ...and the data: placeholder is not what ends up in the body.
    assert.doesNotMatch(content, /src=["']data:/i, "the data: placeholder must not survive");
  });
});
