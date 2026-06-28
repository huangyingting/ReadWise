/**
 * Tests for the Knowable Magazine provider cleanup (Part B of the image-loss /
 * donate-CTA fix).
 *
 * Knowable's PB-hosted article pages embed donation CTAs, leftover Froala
 * editor "layout" menus (whose `<option>` template text — "Some Placeholder
 * Text", "CREDIT: NAME", "Institution Name" — used to leak into the body) and
 * related-article rails inside/around the article. The provider's `cleanup`
 * config drops those noise blocks before extraction while preserving the real
 * prose, the `/docserver/` article imagery and genuine photo captions.
 *
 * Crucially the cleanup must NOT over-drop: the portrait lives in
 * `.article-sidebar-img`, so `article-sidebar` is deliberately not a keyword.
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
  "https://knowablemagazine.org/content/article/mind/2026/what-addiction-does-to-synapses-in-brain";

/** Builds a unique-word block so assertions can target the real body. */
function wordBlock(n: number, seed: string): string {
  return Array.from({ length: n }, (_, i) => `${seed}${i + 1}`).join(" ");
}

/**
 * Minimal Knowable page fixture mirroring the real DOM shape: a `<main>` with
 * the `.fr-view` body (real prose + a `/docserver/` portrait in
 * `.article-sidebar-img` + a genuine `.article-photo-info` caption), an in-body
 * `.promo-article-donate` CTA, an un-hydrated `.comic-layout-mode-menu` Froala
 * widget carrying the placeholder template text, a `.ymalImage` related rail,
 * and `.site-header` chrome carrying a DONATE link.
 */
const KNOWABLE_HTML = `<!doctype html>
<html>
  <head>
    <meta property="og:title" content="What addiction does to the brain" />
  </head>
  <body>
    <header class="site-header">
      <a href="/support-knowable-magazine">DONATE</a>
    </header>
    <main>
      <article>
        <h1>What addiction does to the brain</h1>
        <div class="fr-view">
          <aside class="article-sidebar -right">
            <div class="article-sidebar-img">
              <img class="fr-fil fr-dib" src="/docserver/fulltext/i-marina-wolf.jpg"
                   alt="Portrait of neuroscientist Marina Wolf" />
            </div>
          </aside>
          <p>${wordBlock(45, "synapse")} as addiction reshapes reward circuits.</p>
          <p>${wordBlock(45, "dopamine")} long after the drug is gone.</p>
          <figure class="article-photo-info">
            <img src="/docserver/fulltext/synapse-connectivity.jpg" alt="Synapse connectivity diagram" />
            <figcaption class="article-photo-info-credit">CREDIT: KNOWABLE MAGAZINE / Studies in rodents reveal lasting change.</figcaption>
          </figure>
          <p>${wordBlock(45, "plasticity")} reversing the damage remains hard.</p>
          <div class="promo-article-donate">
            <h3>Support sound science and smart stories</h3>
            <p>Help us make scientific knowledge accessible to all.</p>
            <a href="/support-knowable-magazine">DONATE TODAY</a>
          </div>
          <div class="comic-layout-mode-menu">
            <select>
              <option value="&lt;p&gt;Some Placeholder Text&lt;/p&gt;">Layout A</option>
              <option value="&lt;p&gt;CREDIT: NAME&lt;/p&gt;">Layout B</option>
              <option value="&lt;p&gt;Institution Name&lt;/p&gt;">Layout C</option>
            </select>
            <img src="/pb-assets/placeholder_img.jpg" alt="" />
          </div>
        </div>
      </article>
      <aside class="ymalImage promo">
        <h3>You may also like</h3>
        <a href="/other"><img src="/docserver/fulltext/war-and-drugs.jpg" alt="War and drugs" /></a>
      </aside>
    </main>
    <footer class="site-footer">
      <a href="/support-knowable-magazine">GIVE NOW</a>
    </footer>
  </body>
</html>`;

test("knowable provider defines the donate/placeholder cleanup keywords", () => {
  const provider = getProvider("knowable");
  const keywords = provider?.cleanup?.dropClassKeywords ?? [];
  assert.ok(keywords.length, "cleanup.dropClassKeywords must be set");
  for (const kw of ["promo-article", "comic-layout-mode-menu", "ymal", "site-header", "site-footer"]) {
    assert.ok(keywords.includes(kw), `must drop "${kw}" blocks`);
  }
  // Must NOT list article-sidebar — it would also match article-sidebar-img and
  // delete the real portrait.
  assert.ok(
    !keywords.includes("article-sidebar"),
    "article-sidebar must NOT be dropped (it holds the portrait)",
  );
});

test("knowable cleanup removes donate + placeholder noise, keeps body + /docserver/ imagery", () => {
  const provider = getProvider("knowable");
  const cleaned = applyProviderCleanup(KNOWABLE_HTML, provider!.cleanup!);

  // Real body prose survives.
  assert.match(cleaned, /synapse1\b/, "body prose must be retained");
  assert.match(cleaned, /plasticity1\b/, "body prose must be retained");

  // The real portrait (in .article-sidebar-img) survives — NOT over-dropped.
  assert.match(cleaned, /i-marina-wolf\.jpg/, "portrait /docserver/ image must be retained");
  // The genuine photo caption survives (article-photo-info is NOT dropped).
  assert.match(cleaned, /Studies in rodents/, "real photo caption must be retained");

  // Donate CTAs are gone.
  assert.doesNotMatch(cleaned, /Support sound science/i, "in-body donate CTA must be removed");
  assert.doesNotMatch(cleaned, /DONATE TODAY/i, "donate button must be removed");
  assert.doesNotMatch(cleaned, /GIVE NOW/i, "footer give-now must be removed");

  // Froala placeholder template text is gone.
  assert.doesNotMatch(cleaned, /Some Placeholder Text/i, "placeholder option text must be removed");
  assert.doesNotMatch(cleaned, /Institution Name/i, "placeholder option text must be removed");

  // Related-article rail (other articles' thumbnails) is gone.
  assert.doesNotMatch(cleaned, /You may also like/i, "ymal rail must be removed");
  assert.doesNotMatch(cleaned, /war-and-drugs\.jpg/, "related-article thumbnail must be removed");
});

test("extractArticle on a Knowable page keeps the portrait, drops donate/placeholder", () => {
  // Force the legacy harvest path: on real Knowable pages Readability extracts
  // only ~76 words (no <article> wrapper around the Froala body) so the harvest
  // wins — this mirrors production.
  const prev = process.env.SCRAPER_READABILITY;
  process.env.SCRAPER_READABILITY = "false";
  try {
    const result = extractArticle(KNOWABLE_HTML, ARTICLE_URL);
    assert.ok(result, "extraction must succeed");

    // Provider resolved to Knowable (so the cleanup ran).
    assert.equal(result!.source, "Knowable Magazine");
    const content = result!.content;

    // The real article portrait is present with an ABSOLUTE knowable src.
    assert.match(
      content,
      /<img[^>]*\bsrc=["']https:\/\/knowablemagazine\.org\/docserver\/fulltext\/i-marina-wolf\.jpg["']/i,
      "portrait image must be preserved with an absolute /docserver/ src",
    );

    // The user's complaint — donate CTAs — is gone.
    assert.doesNotMatch(content, /donate/i, "no donate text in the final body");
    assert.doesNotMatch(content, /give now/i, "no give-now text in the final body");

    // Placeholder template junk is gone.
    assert.doesNotMatch(content, /Some Placeholder Text/i, "no placeholder text in the final body");
    assert.doesNotMatch(content, /Institution Name/i, "no placeholder text in the final body");

    // Body prose retained and the word count is sane (not the old bloat).
    assert.match(content, /synapse1\b/, "body prose retained");
    assert.ok(result!.wordCount >= 50, `word count should be article-sized, got ${result!.wordCount}`);
  } finally {
    if (prev === undefined) delete process.env.SCRAPER_READABILITY;
    else process.env.SCRAPER_READABILITY = prev;
  }
});
