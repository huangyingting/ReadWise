/**
 * Tests for the Undark provider cleanup + the shared signup-promo declutter.
 *
 * Undark interleaves two non-article blocks into the WordPress post body:
 *   1. a beige "Support Undark Magazine… please consider making a donation"
 *      callout, wrapped in the Undark-specific `wp-block-undark-fade-in`
 *      animation container (it also carries `has-beige-background-color`), and
 *   2. a class-less inline "SIGN UP FOR NEWSLETTER JOURNEYS:…" promo — an icon
 *      image plus a blurb inside style-only `<div>`s — that has no class hook.
 *
 * The provider `cleanup` drops the support callout (`wp-block-undark-fade-in`)
 * and the page's `newsletter-signup` widgets (`newsletter`) before extraction.
 * The class-less inline promo is caught later by the shared declutter pass
 * (it OPENS with a signup imperative), which removes the whole promo — icon
 * included — without touching the bare `wp-block-paragraph` body.
 *
 * All fixtures are inline — no network or DB is touched.
 */
process.env.LOG_LEVEL = "error";

import { test } from "node:test";
import assert from "node:assert/strict";
import { applyProviderCleanup } from "@/lib/scraper/cleanup";
import { extractArticle } from "@/lib/scraper/extract";
import { getProvider } from "@/lib/scraper/providers";

const ARTICLE_URL = "https://undark.org/2026/06/24/embryo-editing-disease-advocacy/";

/** Builds a unique-word block so assertions can target the real body. */
function wordBlock(n: number, seed: string): string {
  return Array.from({ length: n }, (_, i) => `${seed}${i + 1}`).join(" ");
}

/**
 * Minimal Undark page fixture mirroring the real DOM shape: a `<article>` with
 * a real inline figure image and `wp-block-paragraph` body prose, the beige
 * `wp-block-undark-fade-in` support/donation callout, the class-less inline
 * "SIGN UP FOR NEWSLETTER JOURNEYS" promo (icon + blurb between `<hr>`s), and a
 * `newsletter-signup` sidebar widget.
 */
const UNDARK_HTML = `<!doctype html>
<html>
  <head>
    <meta property="og:title" content="Embryo editing and disease advocacy" />
  </head>
  <body>
    <main>
      <article>
        <h1>Embryo editing and disease advocacy</h1>
        <figure class="wp-block-image size-large">
          <img src="https://undark.org/wp-content/uploads/2026/06/ivy-composite.jpg"
               alt="A composite of an embryo and a DNA helix" />
        </figure>
        <p class="wp-block-paragraph">${wordBlock(45, "embryo")} as the technology edges toward the clinic.</p>
        <p class="wp-block-paragraph">${wordBlock(45, "advocacy")} groups have shaped the funding landscape.</p>
        <div class="trigger-in-view in-view-delay-200 wp-block-undark-fade-in">
          <div class="wp-block-group has-beige-background-color has-background is-layout-flow">
            <h2 class="wp-block-heading">Support Undark Magazine</h2>
            <p class="wp-block-paragraph">Undark is a non-profit, editorially independent magazine.
            If you would like to help support our journalism, please consider making a donation.
            All proceeds go directly to Undark's editorial fund.</p>
            <a class="wp-block-button__link" href="/donate/">Give Now</a>
          </div>
        </div>
        <p class="wp-block-paragraph">${wordBlock(45, "regulation")} which complicates the path forward.</p>
        <hr>
        <div style="display: flex; align-items: stretch;">
          <div style="flex: 0 0 80px; margin-right: 10px;">
            <img decoding="async" src="https://undark.org/wp-content/uploads/2024/11/compass.png"
                 alt="Newsletter Journeys" style="width: 80px; height:80px;" />
          </div>
          <div style="overflow: hidden;">
            <p style="font-size:1.2em;">
              <a href="https://undark.org/newsletters/" style="text-decoration: none;">
                <span class="bolded">SIGN UP FOR NEWSLETTER JOURNEYS: </span>
              </a>
              <em>Dive deeper into pressing issues with Undark's limited run newsletters.
              Each week for four weeks, you'll receive a hand-picked excerpt from our archive
              related to your subject area of interest. Pick your journeys here.</em>
            </p>
          </div>
        </div>
        <hr>
        <p class="wp-block-paragraph">${wordBlock(45, "conclusion")} as the debate continues to evolve.</p>
        <aside class="newsletter-signup background-light-gray">
          <h3 class="newsletter-signup-title">Get Our Newsletter</h3>
          <p class="newsletter-tagline">Sent weekly.</p>
        </aside>
      </article>
    </main>
  </body>
</html>`;

test("undark provider defines the newsletter/support cleanup keywords", () => {
  const provider = getProvider("undark");
  const keywords = provider?.cleanup?.dropClassKeywords ?? [];
  assert.ok(keywords.length, "cleanup.dropClassKeywords must be set");
  for (const kw of ["newsletter", "wp-block-undark-fade-in"]) {
    assert.ok(keywords.includes(kw), `must drop "${kw}" blocks`);
  }
  // Must NOT drop the bare wp-block-paragraph class — that is the real body.
  assert.ok(
    !keywords.includes("wp-block-paragraph"),
    "wp-block-paragraph must NOT be dropped (it holds the body prose)",
  );
});

test("undark cleanup removes the support callout + newsletter widget, keeps body + inline image", () => {
  const provider = getProvider("undark");
  const cleaned = applyProviderCleanup(UNDARK_HTML, provider!.cleanup!);

  // Beige support / donation callout (wp-block-undark-fade-in) is gone.
  assert.doesNotMatch(cleaned, /Support Undark Magazine/i, "support callout heading must be removed");
  assert.doesNotMatch(cleaned, /support our journalism/i, "support callout text must be removed");
  assert.doesNotMatch(cleaned, /making a donation/i, "donation ask must be removed");

  // The `newsletter-signup` sidebar widget is gone (newsletter keyword).
  assert.doesNotMatch(cleaned, /Get Our Newsletter/i, "newsletter sidebar widget must be removed");

  // Real body prose (bare wp-block-paragraph) + the inline image survive.
  assert.match(cleaned, /embryo1\b/, "body prose must be retained");
  assert.match(cleaned, /regulation1\b/, "body prose AFTER the callout must be retained");
  assert.match(cleaned, /conclusion1\b/, "trailing body prose must be retained");
  assert.match(cleaned, /ivy-composite\.jpg/, "inline article image must be retained");

  // The class-less SIGN UP promo is NOT class-matchable, so it is still present
  // after pre-extraction cleanup — the declutter pass handles it (next test).
  assert.match(cleaned, /SIGN UP FOR NEWSLETTER/i, "class-less promo survives provider cleanup");
});

test("extractArticle on an Undark page removes the SIGN UP promo + icon and the support callout, keeps body + inline image", () => {
  const prev = process.env.SCRAPER_READABILITY;
  process.env.SCRAPER_READABILITY = "false";
  try {
    const result = extractArticle(UNDARK_HTML, ARTICLE_URL);
    assert.ok(result, "extraction must succeed");
    assert.equal(result!.source, "Undark");
    const content = result!.content;

    // The inline newsletter promo (text + icon) is gone after the full pipeline.
    assert.doesNotMatch(content, /SIGN UP FOR NEWSLETTER/i, "inline signup promo text must be gone");
    assert.doesNotMatch(content, /Dive deeper into pressing issues/i, "signup blurb must be gone");
    assert.doesNotMatch(content, /compass\.png/i, "the newsletter icon image must be gone");

    // The support / donation callout is gone.
    assert.doesNotMatch(content, /support our journalism/i, "no support callout in body");
    assert.doesNotMatch(content, /making a donation/i, "no donation ask in body");

    // The real inline article image survives (image-aware harvest from #856 intact).
    assert.match(
      content,
      /<img[^>]*\bsrc=["'][^"']*ivy-composite\.jpg["']/i,
      "inline article image must be preserved",
    );

    // Body prose retained on BOTH sides of the removed blocks, word count sane.
    assert.match(content, /embryo1\b/, "lead body prose retained");
    assert.match(content, /regulation1\b/, "mid body prose retained");
    assert.match(content, /conclusion1\b/, "trailing body prose retained");
    assert.ok(result!.wordCount >= 100, `word count should be article-sized, got ${result!.wordCount}`);
  } finally {
    if (prev === undefined) delete process.env.SCRAPER_READABILITY;
    else process.env.SCRAPER_READABILITY = prev;
  }
});
