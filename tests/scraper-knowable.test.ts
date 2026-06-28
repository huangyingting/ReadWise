/**
 * Tests for the Knowable Magazine provider cleanup (Part B of the image-loss /
 * donate-CTA fix).
 *
 * Knowable's PB-hosted article pages embed donation CTAs, leftover Froala
 * editor "layout" menus (an `article-layout-mode-menu` widget whose
 * `<h4>LAYOUT MENU</h4>` heading leaked into the body and whose `<option>`
 * template text — "Some Placeholder Text", "CREDIT: NAME", "Institution Name" —
 * rode along) and related-article rails inside/around the article. The
 * provider's `cleanup` config drops those noise blocks before extraction while
 * preserving the real prose, the `/docserver/` article imagery and genuine
 * photo captions.
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

/**
 * Fixture mirroring the LIVE (non-comic) Knowable DOM shape: the Froala layout
 * widget renders as `.article-layout-mode-menu` and sits at the very top of the
 * `<main class="main-content-container">`, BEFORE the article body — and the
 * page has no semantic `<article>` wrapper, so the harvest scope is `<main>` and
 * the widget's `<h4> LAYOUT MENU </h4>` heading leaks in as the first harvested
 * block (the exact residual reported across all 14 Knowable articles). The body
 * itself carries a real `/docserver/` portrait and prose that must survive.
 */
const KNOWABLE_LAYOUT_MENU_HTML = `<!doctype html>
<html>
  <head>
    <meta property="og:title" content="What addiction does to the brain" />
  </head>
  <body>
    <main class="col-md-12 content main-content-container js-main-content-container" id="main-content-container">
      <div class="article-layout-mode-menu">
        <h4> LAYOUT MENU </h4>
        <div class="article-layout-mode-menu__menu-grid">
          <div class="article-layout-mode-menu__menu-grid-item">
            <span draggable="true" data-id="insertParagraph" class="js-insert-html-block">Insert PARAGRAPH</span>
          </div>
          <div class="article-layout-mode-menu__menu-grid-item">
            <span draggable="true" data-id="insertAside" class="js-insert-html-block">Insert SIDEBAR WITH IMAGE</span>
            <select name="insertAside_content">
              <option value="&lt;p&gt;Some Placeholder Text&lt;/p&gt;">Some Placeholder Text</option>
              <option value="&lt;p&gt;Institution Name&lt;/p&gt;">Institution Name</option>
            </select>
          </div>
          <span class="lazy">
            <img src="/images/magazine/placeholder_img.jpg" alt="" />
            <img src="/images/magazine/placeholder_img.jpg" alt="" />
          </span>
        </div>
      </div>
      <div class="article-hero" style="background-image: url(/docserver/fulltext/brain-plasticity-1600x600.jpg);"></div>
      <div class="article-container-outer">
        <section class="article-container">
          <div class="fr-view">
            <aside class="article-sidebar -right">
              <div class="article-sidebar-img">
                <img class="fr-fil fr-dib" src="/docserver/fulltext/i-marina-wolf.jpg"
                     alt="Portrait of neuroscientist Marina Wolf" />
              </div>
            </aside>
            <p>${wordBlock(45, "synapse")} as addiction reshapes reward circuits.</p>
            <p>${wordBlock(45, "dopamine")} long after the drug is gone.</p>
            <p>${wordBlock(45, "plasticity")} reversing the damage remains hard.</p>
          </div>
        </section>
      </div>
    </main>
  </body>
</html>`;

/**
 * Fixture mirroring the LIVE Knowable trailing-citation boilerplate the user
 * flagged: after the real `.fr-view` body the page renders the article's own
 * visible DOI (`<div class="article-doi">10.1146/knowable-…</div>`) followed by a
 * `<section class="deep-dive">` whose `<div class="deep-dive-header">` reads
 * "TAKE A DEEPER DIVE | Explore Related Scholarly Articles" and which lists OTHER
 * journal articles' titles/abstracts. Both blocks sit AFTER the body (outside
 * `.fr-view`) but inside the harvest scope, so without cleanup they leak into the
 * extracted prose and word count (verified across all 12 stored Knowable
 * articles). The same DOI also appears in a `<head>` `<meta name="dc.identifier">`
 * that must stay irrelevant (it is never harvested). The body carries a real
 * `/docserver/` image + prose that must survive.
 */
const KNOWABLE_DEEP_DIVE_HTML = `<!doctype html>
<html>
  <head>
    <meta property="og:title" content="What addiction does to the brain" />
    <meta name="dc.identifier" content="doi:10.1146/knowable-042026-2" />
  </head>
  <body>
    <main class="col-md-12 content main-content-container" id="main-content-container">
      <div class="article-container-outer">
        <section class="article-container">
          <div class="fr-view">
            <p>${wordBlock(45, "synapse")} as addiction reshapes reward circuits.</p>
            <figure class="article-photo-info">
              <img src="/docserver/fulltext/synapse-connectivity.jpg" alt="Synapse connectivity diagram" />
              <figcaption class="article-photo-info-credit">CREDIT: KNOWABLE MAGAZINE / Studies in rodents reveal lasting change.</figcaption>
            </figure>
            <p>${wordBlock(45, "dopamine")} long after the drug is gone.</p>
            <p>${wordBlock(45, "plasticity")} reversing the damage remains hard.</p>
          </div>
          <div class="article-doi">10.1146/knowable-042026-2</div>
          <section class="deep-dive">
            <div class="deep-dive-header">TAKE A DEEPER DIVE | Explore Related Scholarly Articles</div>
            <ul class="deep-dive-list">
              <li>
                <a href="/doi/10.1146/annurev-pharmtox-061724"><h3>ANNUAL REVIEW OF PHARMACOLOGY AND TOXICOLOGY</h3></a>
                <p>Synaptic Mechanisms of Addiction: a related scholarly review of reward circuitry.</p>
              </li>
              <li>
                <a href="/doi/10.1146/annurev-neuro-091823"><h3>ANNUAL REVIEW OF NEUROSCIENCE</h3></a>
                <p>Dopamine and Plasticity: another related scholarly article abstract.</p>
              </li>
            </ul>
          </section>
        </section>
      </div>
    </main>
  </body>
</html>`;

test("knowable provider defines the donate/placeholder cleanup keywords", () => {
  const provider = getProvider("knowable");
  const keywords = provider?.cleanup?.dropClassKeywords ?? [];
  assert.ok(keywords.length, "cleanup.dropClassKeywords must be set");
  for (const kw of [
    "promo-article",
    "layout-mode-menu",
    "ymal",
    "deep-dive",
    "article-doi",
    "site-header",
    "site-footer",
  ]) {
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

test("knowable cleanup strips the article-layout-mode-menu widget, keeps body + portrait", () => {
  const provider = getProvider("knowable");
  const cleaned = applyProviderCleanup(KNOWABLE_LAYOUT_MENU_HTML, provider!.cleanup!);

  // The whole Froala "LAYOUT MENU" widget (article-layout-mode-menu) is gone.
  assert.doesNotMatch(cleaned, /LAYOUT MENU/i, "the layout-mode menu heading must be removed");
  assert.doesNotMatch(cleaned, /Insert SIDEBAR WITH IMAGE/i, "menu controls must be removed");
  assert.doesNotMatch(cleaned, /Some Placeholder Text/i, "placeholder option text must be removed");
  assert.doesNotMatch(cleaned, /Institution Name/i, "placeholder option text must be removed");
  assert.doesNotMatch(cleaned, /placeholder_img\.jpg/, "menu placeholder imagery must be removed");

  // Real body + the /docserver/ portrait survive (NOT over-dropped).
  assert.match(cleaned, /synapse1\b/, "body prose must be retained");
  assert.match(cleaned, /plasticity1\b/, "body prose must be retained");
  assert.match(cleaned, /i-marina-wolf\.jpg/, "portrait /docserver/ image must be retained");
});

test("extractArticle drops the LAYOUT MENU chrome but keeps the body + /docserver/ image", () => {
  // Force the legacy harvest path (no <article> wrapper → harvest wins), mirroring
  // production. Without the layout-mode-menu cleanup the <h4>LAYOUT MENU</h4> heading
  // is harvested into the body — the residual reported across all 14 Knowable articles.
  const prev = process.env.SCRAPER_READABILITY;
  process.env.SCRAPER_READABILITY = "false";
  try {
    const result = extractArticle(KNOWABLE_LAYOUT_MENU_HTML, ARTICLE_URL);
    assert.ok(result, "extraction must succeed");
    assert.equal(result!.source, "Knowable Magazine");
    const content = result!.content;

    // THE residual: the UI-control "LAYOUT MENU" string must NOT leak into the body.
    assert.doesNotMatch(content, /LAYOUT MENU/i, "layout-mode menu chrome must be gone from the body");
    assert.doesNotMatch(content, /Some Placeholder Text/i, "no placeholder text in the final body");

    // Image-preservation from #856 stays intact: the real portrait survives absolute.
    assert.match(
      content,
      /<img[^>]*\bsrc=["']https:\/\/knowablemagazine\.org\/docserver\/fulltext\/i-marina-wolf\.jpg["']/i,
      "portrait /docserver/ image must be preserved with an absolute src",
    );

    // Body prose retained and the word count is article-sized (not gutted).
    assert.match(content, /synapse1\b/, "body prose retained");
    assert.match(content, /plasticity1\b/, "body prose retained");
    assert.ok(result!.wordCount >= 50, `word count should be article-sized, got ${result!.wordCount}`);
  } finally {
    if (prev === undefined) delete process.env.SCRAPER_READABILITY;
    else process.env.SCRAPER_READABILITY = prev;
  }
});

test("knowable cleanup strips the deep-dive citation rail + visible DOI, keeps body + /docserver/ image", () => {
  const provider = getProvider("knowable");
  const cleaned = applyProviderCleanup(KNOWABLE_DEEP_DIVE_HTML, provider!.cleanup!);
  // Assert against the BODY region: the `<head>` `<meta name="dc.identifier">`
  // legitimately keeps the DOI, but it is never harvested into the article body.
  const body = cleaned.slice(cleaned.indexOf("</head>"));

  // The whole "TAKE A DEEPER DIVE / Related Scholarly Articles" rail is gone —
  // the `deep-dive` keyword substring-matches both `.deep-dive` and its nested
  // `.deep-dive-header`.
  assert.doesNotMatch(body, /TAKE A DEEP/i, "deep-dive header must be removed");
  assert.doesNotMatch(body, /DEEPER DIVE/i, "deep-dive header must be removed");
  assert.doesNotMatch(body, /Related Scholarly/i, "related-scholarly rail must be removed");
  assert.doesNotMatch(body, /ANNUAL REVIEW OF/i, "related journal headings must be removed");
  assert.doesNotMatch(cleaned, /class="deep-dive/i, "the deep-dive container must be removed");

  // The visible `.article-doi` block is gone from the body.
  assert.doesNotMatch(body, /10\.1146\/knowable/i, "visible article DOI must be removed");
  assert.doesNotMatch(cleaned, /class="article-doi"/i, "the article-doi container must be removed");

  // Real body + the /docserver/ image survive (NOT over-dropped).
  assert.match(cleaned, /synapse1\b/, "body prose must be retained");
  assert.match(cleaned, /plasticity1\b/, "body prose must be retained");
  assert.match(cleaned, /synapse-connectivity\.jpg/, "body /docserver/ image must be retained");
  assert.match(cleaned, /Studies in rodents/, "genuine photo caption must be retained");
});

test("extractArticle strips the deep-dive/DOI boilerplate, keeps the body + /docserver/ image", () => {
  // Force the legacy harvest path (no <article> wrapper → harvest wins), mirroring
  // production: real Knowable pages carry no JSON-LD articleBody, so the DOM harvest
  // is canonical and the trailing deep-dive/DOI blocks leak into the body without
  // the cleanup (verified across all 12 stored Knowable articles).
  const prev = process.env.SCRAPER_READABILITY;
  process.env.SCRAPER_READABILITY = "false";
  try {
    const result = extractArticle(KNOWABLE_DEEP_DIVE_HTML, ARTICLE_URL);
    assert.ok(result, "extraction must succeed");
    assert.equal(result!.source, "Knowable Magazine");
    const content = result!.content;

    // The user's complaint — the trailing citation boilerplate — is gone.
    assert.doesNotMatch(content, /TAKE A DEEP/i, "no deep-dive header in the final body");
    assert.doesNotMatch(content, /DEEPER DIVE/i, "no deep-dive header in the final body");
    assert.doesNotMatch(content, /Related Scholarly/i, "no related-scholarly rail in the final body");
    assert.doesNotMatch(content, /10\.1146\/knowable/i, "no visible DOI string in the final body");

    // The real article image survives with an ABSOLUTE knowable src (image-aware
    // harvest from #856 stays intact).
    assert.match(
      content,
      /<img[^>]*\bsrc=["']https:\/\/knowablemagazine\.org\/docserver\/fulltext\/synapse-connectivity\.jpg["']/i,
      "body /docserver/ image must be preserved with an absolute src",
    );

    // Body prose retained and the word count is article-sized (not gutted).
    assert.match(content, /synapse1\b/, "body prose retained");
    assert.match(content, /plasticity1\b/, "body prose retained");
    assert.ok(result!.wordCount >= 50, `word count should be article-sized, got ${result!.wordCount}`);
  } finally {
    if (prev === undefined) delete process.env.SCRAPER_READABILITY;
    else process.env.SCRAPER_READABILITY = prev;
  }
});
