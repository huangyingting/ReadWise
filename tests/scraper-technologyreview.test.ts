/**
 * Tests for the MIT Technology Review provider cleanup.
 *
 * MIT article pages render two non-article widgets INSIDE the article container
 * that the body harvest would otherwise keep:
 *   1. a "Stay Connected" newsletter signup form whose hidden response text
 *      ("…thank you for submitting your email!… reach out to us at
 *      customer-service@technologyreview.com with a list of newsletters you'd
 *      like to receive.") leaks into the prose, and
 *   2. a "Deep Dive" related-articles rail (a section title plus post cards).
 *
 * MIT ships CSS-module hashed class names (e.g. `stayConnected__link--<hash>`,
 * `deepDiveItem__wrapper`), and the cleanup matches a class/id SUBSTRING on
 * block containers, so the provider drops `stayConnected`, `deepDiveItem` and
 * `deepDive__sectionTitle`. The outer `deepDive__wrapper` is intentionally NOT
 * dropped (emptying rather than removing it keeps Readability's lead-image
 * scoring stable); the leftover empty wrapper is collapsed downstream.
 *
 * All fixtures are inline — no network or DB is touched.
 */
process.env.LOG_LEVEL = "error";

import { test } from "node:test";
import assert from "node:assert/strict";
import { applyProviderCleanup } from "@/lib/scraper/cleanup";
import { extractArticle } from "@/lib/scraper/extract";
import { getProvider } from "@/lib/scraper/providers";

const ARTICLE_URL =
  "https://www.technologyreview.com/2026/06/26/1139780/heat-waves-mess-with-your-brain/";

/** Builds a unique-word block so assertions can target the real body. */
function wordBlock(n: number, seed: string): string {
  return Array.from({ length: n }, (_, i) => `${seed}${i + 1}`).join(" ");
}

/**
 * Minimal MIT page fixture mirroring the real DOM shape: an `<article>` with a
 * lead image, real prose, a hashed-class `stayConnected__wrapper` newsletter
 * form (carrying the customer-service response text) and a `deepDive__wrapper`
 * rail (section title + `deepDiveItem__wrapper` cards).
 */
const MIT_HTML = `<!doctype html>
<html>
  <head>
    <meta property="og:title" content="Heat waves mess with your brain" />
  </head>
  <body>
    <main>
      <article>
        <h1>Heat waves mess with your brain</h1>
        <figure class="image__wrapper--a1b2c3">
          <img src="https://wp.technologyreview.com/wp-content/uploads/2026/06/heatbrain.jpg"
               alt="A thermal image of a human head" />
        </figure>
        <p>${wordBlock(45, "neuron")} as core temperature climbs past the body's set point.</p>
        <p>${wordBlock(45, "cortex")} and cognition slows when the heat persists for days.</p>
        <p>${wordBlock(45, "thermoregulation")} which is why researchers are worried.</p>
        <div class="stayConnected__wrapper--d4e5f6">
          <div class="stayConnected__sectionTitle--d4e5f6">Stay Connected</div>
          <form class="stayConnected__form--d4e5f6">
            <input class="stayConnected__input--d4e5f6" placeholder="Enter your email" />
            <button class="stayConnected__link--d4e5f6">Sign up</button>
          </form>
          <div class="stayConnected__responseMessage--d4e5f6">
            Thank you for submitting your email! It looks like something went wrong.
            Please try again later. Otherwise, if you continue to have issues, please
            reach out to us at customer-service@technologyreview.com with a list of
            newsletters you'd like to receive.
          </div>
        </div>
        <div class="deepDive__wrapper--g7h8i9">
          <div class="deepDive__sectionTitle--g7h8i9">Deep Dive</div>
          <div class="deepDive__posts--g7h8i9">
            <div class="deepDiveItem__wrapper--g7h8i9">
              <a href="/2026/06/01/aaa/"><h3>Another MIT story about chips and Moore's law</h3></a>
              <p>An unrelated related-rail teaser that is not part of this article.</p>
            </div>
            <div class="deepDiveItem__wrapper--g7h8i9">
              <a href="/2026/06/02/bbb/"><h3>A second MIT story about the power grid</h3></a>
              <p>Another teaser paragraph that must not survive into the body.</p>
            </div>
          </div>
        </div>
      </article>
    </main>
  </body>
</html>`;

test("technologyreview provider defines the newsletter/deep-dive cleanup keywords", () => {
  const provider = getProvider("technologyreview");
  const keywords = provider?.cleanup?.dropClassKeywords ?? [];
  assert.ok(keywords.length, "cleanup.dropClassKeywords must be set");
  for (const kw of ["stayConnected", "deepDiveItem", "deepDive__sectionTitle"]) {
    assert.ok(keywords.includes(kw), `must drop "${kw}" blocks`);
  }
  // The outer deepDive wrapper must NOT be dropped wholesale (image-scoring
  // stability) — only its inner items + the bare section title.
  assert.ok(
    !keywords.includes("deepDive__wrapper") && !keywords.includes("deepDive__posts"),
    "outer deepDive wrapper must NOT be a keyword",
  );
});

test("technologyreview cleanup removes the newsletter form + deep-dive rail, keeps body + lead image", () => {
  const provider = getProvider("technologyreview");
  const cleaned = applyProviderCleanup(MIT_HTML, provider!.cleanup!);

  // Newsletter "Stay Connected" form (incl. the customer-service response) is gone.
  assert.doesNotMatch(cleaned, /submitting your email/i, "newsletter response text must be removed");
  assert.doesNotMatch(cleaned, /customer-service@technologyreview/i, "newsletter contact must be removed");
  assert.doesNotMatch(cleaned, /newsletters you'd like/i, "newsletter response text must be removed");
  assert.doesNotMatch(cleaned, /Stay Connected/i, "newsletter section title must be removed");

  // Deep Dive related rail (heading + cards) is gone.
  assert.doesNotMatch(cleaned, /Deep Dive/i, "deep-dive section title must be removed");
  assert.doesNotMatch(cleaned, /Moore's law/i, "related-rail card must be removed");
  assert.doesNotMatch(cleaned, /the power grid/i, "related-rail card must be removed");

  // Real body prose + the lead image survive (NOT over-dropped).
  assert.match(cleaned, /neuron1\b/, "body prose must be retained");
  assert.match(cleaned, /thermoregulation1\b/, "body prose must be retained");
  assert.match(cleaned, /heatbrain\.jpg/, "lead article image must be retained");
});

test("extractArticle on an MIT page drops the newsletter/deep-dive noise, keeps body + inline image", () => {
  const prev = process.env.SCRAPER_READABILITY;
  process.env.SCRAPER_READABILITY = "false";
  try {
    const result = extractArticle(MIT_HTML, ARTICLE_URL);
    assert.ok(result, "extraction must succeed");
    assert.equal(result!.source, "MIT Technology Review");
    const content = result!.content;

    // The user's complaint — newsletter form + deep-dive rail — is gone.
    assert.doesNotMatch(content, /submitting your email/i, "no newsletter response text in body");
    assert.doesNotMatch(content, /customer-service@technologyreview/i, "no newsletter contact in body");
    assert.doesNotMatch(content, /newsletters you'd like/i, "no newsletter response text in body");
    assert.doesNotMatch(content, /Deep Dive/i, "no deep-dive heading in body");
    assert.doesNotMatch(content, /Moore's law/i, "no related-rail card in body");

    // The inline article image survives (image-aware harvest from #856 intact).
    assert.match(
      content,
      /<img[^>]*\bsrc=["'][^"']*heatbrain\.jpg["']/i,
      "inline article image must be preserved",
    );

    // Body prose retained and the word count is article-sized (not gutted).
    assert.match(content, /neuron1\b/, "body prose retained");
    assert.match(content, /thermoregulation1\b/, "body prose retained");
    assert.ok(result!.wordCount >= 100, `word count should be article-sized, got ${result!.wordCount}`);
  } finally {
    if (prev === undefined) delete process.env.SCRAPER_READABILITY;
    else process.env.SCRAPER_READABILITY = prev;
  }
});
