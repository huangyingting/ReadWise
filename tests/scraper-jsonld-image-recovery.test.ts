/**
 * Tests for JSON-LD-body inline-image recovery (Part B of the image-loss fix).
 *
 * Some providers (e.g. NBC News) serve a JSON-LD `articleBody` — canonical but
 * plain text, so wrapping it in `<p>` yields ZERO images. The body-choice logic
 * used to keep that JSON-LD body unconditionally and never even consider the
 * Readability body, dropping every inline `<img>` Readability had captured.
 *
 * `extractArticle` now prefers the Readability body over an image-less JSON-LD
 * body when Readability captured content image(s) over a comparable-length body
 * (>= `READABILITY_LD_MIN_WORD_RATIO` of the JSON-LD word count). A short
 * Readability stub still loses to the full canonical JSON-LD body, so we never
 * trade real prose for an image.
 *
 * Readability is forced ON (its default) so the choice is deterministic. All
 * fixtures are inline — no network or DB is touched.
 */
process.env.LOG_LEVEL = "error";

import { test } from "node:test";
import assert from "node:assert/strict";
import { extractArticle, stripTags } from "@/lib/scraper/extract";

/** Builds a unique-word block so assertions can target a specific body. */
function wordBlock(n: number, seed: string): string {
  return Array.from({ length: n }, (_, i) => `${seed}${i + 1}`).join(" ");
}

/** Counts whitespace-delimited tokens (matches extract.ts's countWords). */
function countWords(text: string): number {
  const m = text.match(/\S+/g);
  return m ? m.length : 0;
}

/**
 * Runs `fn` with the Readability body pipeline forced ON (its default),
 * restoring the previous `SCRAPER_READABILITY` value afterwards. Guards the test
 * against an ambient `SCRAPER_READABILITY=false` in the environment.
 */
function withReadability(fn: () => void): void {
  const prev = process.env.SCRAPER_READABILITY;
  process.env.SCRAPER_READABILITY = "true";
  try {
    fn();
  } finally {
    if (prev === undefined) delete process.env.SCRAPER_READABILITY;
    else process.env.SCRAPER_READABILITY = prev;
  }
}

/** Serializes a JSON-LD NewsArticle script with a plain-text articleBody. */
function jsonLdScript(articleBody: string): string {
  const ld = {
    "@type": "NewsArticle",
    headline: "Mapping the Cosmic Web",
    author: { name: "Dana Cosmos" },
    articleBody,
    datePublished: "2026-03-04T09:00:00Z",
    description: "A short summary.",
  };
  return `<script type="application/ld+json">${JSON.stringify(ld)}</script>`;
}

test("extractArticle recovers an inline image when the JSON-LD body is image-less but Readability has one", () => {
  // JSON-LD articleBody: ~135 words of canonical PLAIN TEXT -> zero images.
  const ldBody = `Structured canonical paragraph follows here. ${wordBlock(130, "canon")} and that concludes it.`;

  // DOM body: comparable-length prose PLUS a real content <figure><img>.
  const html =
    "<!doctype html><html><head><title>Mapping the Cosmic Web</title>" +
    jsonLdScript(ldBody) +
    "</head><body><article><h1>Mapping the Cosmic Web</h1>" +
    `<p>Astronomers charted a new filament today. ${wordBlock(45, "galaxy")} stretched across the void.</p>` +
    '<figure><img src="https://cdn.example.com/images/cosmic-web.jpg" ' +
    'alt="A simulated filament of the cosmic web">' +
    "<figcaption>A simulated filament of the cosmic web.</figcaption></figure>" +
    `<p>The survey spanned several years of work. ${wordBlock(45, "survey")} of patient observation.</p>` +
    `<p>Future telescopes will sharpen the map. ${wordBlock(40, "future")} in the coming decade.</p>` +
    "</article></body></html>";

  withReadability(() => {
    const result = extractArticle(html, "https://cosmology.example.org/news/cosmic-web");
    assert.ok(result, "article should extract");
    const content = result!.content;

    // The inline content image is RECOVERED (the whole point of the fix).
    assert.match(
      content,
      /<img[^>]*\bsrc=["']https:\/\/cdn\.example\.com\/images\/cosmic-web\.jpg["']/i,
      "the inline content image must be recovered from the Readability body",
    );
    // The Readability prose replaced the JSON-LD body, so DOM-only prose is kept...
    assert.match(content, /galaxy1\b/, "Readability (DOM) prose must be kept");
    // ...and the JSON-LD-exclusive marker is gone (we switched off the ld body).
    assert.doesNotMatch(content, /canon1\b/, "image-less JSON-LD body must be replaced");

    // Prose is not truncated: comparable to the JSON-LD body's word count.
    const ldWords = countWords(stripTags(ldBody));
    const bodyWords = result!.wordCount;
    assert.ok(
      bodyWords >= ldWords * 0.6,
      `recovered body (${bodyWords} words) must stay comparable to the JSON-LD body (${ldWords} words)`,
    );
  });
});

test("extractArticle keeps the full JSON-LD body when Readability is only a short stub (image not forced)", () => {
  // JSON-LD articleBody: ~305 words — the FULL canonical body.
  const ldBody = `Full canonical tidal report begins here. ${wordBlock(300, "fullbody")} and that is the complete account.`;

  // DOM body: a SHORT ~95-word stub that happens to carry an image. Switching to
  // it would discard ~210 words of real prose, so the floor must reject it.
  const html =
    "<!doctype html><html><head><title>A Quick Note on Tides</title>" +
    jsonLdScript(ldBody) +
    "</head><body><article><h1>A Quick Note on Tides</h1>" +
    `<p>A brief tidal note for readers. ${wordBlock(45, "tide")} observed near the shore.</p>` +
    '<figure><img src="https://cdn.example.com/images/tide-pool.jpg" alt="A tide pool"></figure>' +
    `<p>That is all for the moment. ${wordBlock(45, "brief")} until the next bulletin.</p>` +
    "</article></body></html>";

  withReadability(() => {
    const result = extractArticle(html, "https://oceans.example.org/news/tides");
    assert.ok(result, "article should extract");
    const content = result!.content;

    // The full canonical JSON-LD prose is kept...
    assert.match(content, /fullbody1\b/, "the full JSON-LD body must be kept");
    // ...and the short Readability stub (and its image) is NOT forced in.
    assert.doesNotMatch(content, /tide-pool\.jpg/i, "the stub image must not be forced");
    assert.doesNotMatch(content, /tide1\b/, "the short Readability stub must not replace the body");

    // Word count reflects the full canonical body, not the ~95-word stub.
    const ldWords = countWords(stripTags(ldBody));
    assert.ok(
      result!.wordCount >= ldWords * 0.9,
      `kept body (${result!.wordCount} words) must reflect the full JSON-LD body (${ldWords} words)`,
    );
  });
});
