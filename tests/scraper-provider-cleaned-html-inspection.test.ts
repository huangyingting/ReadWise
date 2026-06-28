/**
 * Focused cleaned-HTML inspections for provider noise removal.
 *
 * These fixtures intentionally inspect the intermediate provider-cleaned HTML
 * before Readability/declutter, then the final extracted body where useful. The
 * goal is to catch provider chrome remnants (ads, newsletters, related rails,
 * social widgets and editor/template cruft) while explicitly preserving article
 * media.
 */
process.env.LOG_LEVEL = "error";

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  GENERIC_PROVIDER_CLEANUP,
  applyProviderCleanup,
  mergeProviderCleanup,
} from "@/lib/scraper/cleanup";
import { extractArticle } from "@/lib/scraper/extract";
import { getProvider } from "@/lib/scraper/providers";

function wordBlock(n: number, seed: string): string {
  return Array.from({ length: n }, (_, i) => `${seed}${i + 1}`).join(" ");
}

function assertNoProviderNoise(html: string, patterns: RegExp[]): void {
  for (const pattern of patterns) {
    assert.doesNotMatch(html, pattern, `unexpected provider noise remained: ${pattern}`);
  }
}

test("unknown-provider extraction preserves legitimate newsletter article and image", () => {
  const html = `<!doctype html><html><head>
    <meta property="og:title" content="Letters from the Mountain Observatory" />
    </head><body>
      <main>
        <article class="newsletter">
          <h1>Letters from the Mountain Observatory</h1>
          <p>${wordBlock(40, "summit")} as observers describe how patient reading of the weather records reveals gradual seasonal changes.</p>
          <figure>
            <img src="/images/observatory-sky.jpg" alt="Night sky above the observatory" />
            <figcaption>The observatory's night sky remains part of the field report.</figcaption>
          </figure>
          <p>${wordBlock(40, "telescope")} as the team compares notes from several weeks of careful measurements and local interviews.</p>
          <p>${wordBlock(40, "valley")} as the final dispatch explains why the findings matter to residents downstream.</p>
        </article>
      </main>
    </body></html>`;

  const result = extractArticle(html, "https://independent.example.org/letters/observatory");
  assert.ok(result, "unknown-provider newsletter article should extract");
  assert.match(result!.content, /summit1/i, "article prose must survive extraction");
  assert.match(result!.content, /telescope1/i, "middle article prose must survive extraction");
  assert.match(result!.content, /observatory-sky\.jpg/i, "article image must survive extraction");
  assert.match(
    result!.content,
    /https:\/\/independent\.example\.org\/images\/observatory-sky\.jpg/i,
    "relative article image must be absolutized",
  );
});

test("nbc cleaned HTML drops provider chrome but keeps article image and video link", () => {
  const provider = getProvider("nbc");
  assert.ok(provider?.cleanup, "NBC cleanup rules must be present");

  const html = `<!doctype html><html><head>
    <meta property="og:title" content="Orcas Return to Northern Waters" />
    </head><body><article>
      <h1>Orcas Return to Northern Waters</h1>
      <p>${wordBlock(45, "orca")} as researchers document a changing migration.</p>
      <figure><img src="https://media.nbcnews.com/orca-breach.jpg" alt="An orca breaching" /></figure>
      <p>The research team also published a <a href="https://www.nbcnews.com/video/orca-field-report">field video report</a> for readers.</p>
      <aside class="related"><h2>Related</h2><a href="/other">Another story</a></aside>
      <div class="social-share">Share on Facebook</div>
      <div class="newsletter">Sign up for the morning newsletter</div>
      <div class="promo">Limited time subscription promotion</div>
      <div class="cookie-consent">Accept cookies to continue reading</div>
      <iframe src="https://ads.example/frame"></iframe>
      <p>${wordBlock(45, "habitat")} as conservation crews track the animals.</p>
    </article></body></html>`;

  const cleaned = applyProviderCleanup(
    html,
    mergeProviderCleanup(GENERIC_PROVIDER_CLEANUP, provider.cleanup),
  );
  assertNoProviderNoise(cleaned, [
    /Another story/i,
    /Share on Facebook/i,
    /morning newsletter/i,
    /subscription promotion/i,
    /Accept cookies/i,
    /ads\.example/i,
  ]);
  assert.match(cleaned, /orca-breach\.jpg/i, "article image must survive cleanup");
  assert.match(cleaned, /video\/orca-field-report/i, "article video link must survive cleanup");

  const result = extractArticle(html, "https://www.nbcnews.com/science/orcas-return-rcna123456");
  assert.ok(result, "article should extract");
  assertNoProviderNoise(result!.content, [
    /Another story/i,
    /Share on/i,
    /newsletter/i,
    /promotion/i,
    /Accept cookies/i,
  ]);
  assert.match(result!.content, /orca-breach\.jpg/i, "article image must survive final extraction");
  assert.match(result!.content, /video\/orca-field-report/i, "article video link must survive final extraction");
});

test("knowable cleaned HTML drops editor/donation/deep-dive remnants but keeps docserver media", () => {
  const provider = getProvider("knowable");
  assert.ok(provider?.cleanup, "Knowable cleanup rules must be present");

  const html = `<!doctype html><html><head>
    <meta property="og:title" content="How Synapses Recover" />
    </head><body>
      <header class="site-header"><a>DONATE</a></header>
      <main class="main-content-container">
        <div class="article-layout-mode-menu">
          <h4>LAYOUT MENU</h4>
          <select><option>Some Placeholder Text</option><option>Institution Name</option></select>
          <img src="/images/magazine/placeholder_img.jpg" alt="" />
        </div>
        <section class="article-container">
          <div class="fr-view">
            <p>${wordBlock(45, "synapse")} as recovery begins inside neural circuits.</p>
            <figure class="article-photo-info">
              <img src="/docserver/fulltext/synapse-recovery.jpg" alt="Synapse diagram" />
              <figcaption>CREDIT: KNOWABLE MAGAZINE / A genuine article caption.</figcaption>
            </figure>
            <p>${wordBlock(45, "neuron")} as the therapy is tested.</p>
            <div class="promo-article-donate">Support Knowable and DONATE TODAY</div>
            <p>${wordBlock(45, "plasticity")} as clinicians follow the evidence.</p>
          </div>
          <div class="article-doi">10.1146/knowable-062826-1</div>
          <section class="deep-dive">
            <div class="deep-dive-header">TAKE A DEEPER DIVE | Explore Related Scholarly Articles</div>
            <p>ANNUAL REVIEW OF NEUROSCIENCE related abstract from another article.</p>
          </section>
        </section>
      </main>
    </body></html>`;

  const cleaned = applyProviderCleanup(html, provider.cleanup);
  const body = cleaned.slice(cleaned.indexOf("</head>"));
  assertNoProviderNoise(body, [
    /DONATE/i,
    /LAYOUT MENU/i,
    /Some Placeholder Text/i,
    /Institution Name/i,
    /placeholder_img/i,
    /TAKE A DEEPER DIVE/i,
    /Related Scholarly/i,
    /ANNUAL REVIEW OF/i,
    /10\.1146\/knowable/i,
  ]);
  assert.match(cleaned, /docserver\/fulltext\/synapse-recovery\.jpg/i, "article image must survive cleanup");
  assert.match(cleaned, /genuine article caption/i, "article caption must survive cleanup");
});

test("bbc learning cleaned HTML drops related episode bloat while retaining transcript media link", () => {
  const provider = getProvider("bbc-learning-english");
  assert.ok(provider?.cleanup, "BBC Learning cleanup rules must be present");

  const html = `<!doctype html><html><head>
    <meta property="og:title" content="6 Minute English: Learning together" />
    </head><body>
      <div class="widget widget-richtext">
        <p>${wordBlock(35, "lesson")} as the hosts introduce the vocabulary.</p>
        <p>The downloadable <a href="https://www.bbc.co.uk/learningenglish/audio/episode.mp3">audio programme</a> remains part of the lesson.</p>
        <p>${wordBlock(35, "vocab")} as learners practise the expressions.</p>
      </div>
      <div class="widget widget-list widget-list-automatic">
        <h3>More 6 Minute English</h3>
        <p>Can a woollen hat make a difference when you are cold?</p>
        <p>Neil and Catherine talk about genealogy.</p>
      </div>
      <div class="bbcle-course-nav-list">Course navigation listing every unit.</div>
      <div class="bbcle-footer-nav-list">Footer navigation to other lessons.</div>
    </body></html>`;

  const cleaned = applyProviderCleanup(html, provider.cleanup);
  assertNoProviderNoise(cleaned, [
    /More 6 Minute English/i,
    /woollen hat/i,
    /genealogy/i,
    /Course navigation/i,
    /Footer navigation/i,
  ]);
  assert.match(cleaned, /hosts introduce the vocabulary/i, "transcript text must survive cleanup");
  assert.match(cleaned, /audio\/episode\.mp3/i, "lesson media link must survive cleanup");
});

test("nautilus cleaned extraction drops trailing CTA/favicon and keeps article image", () => {
  const provider = getProvider("nautilus");
  assert.ok(provider?.cleanup, "Nautilus cleanup rules must be present");

  const html = `<!doctype html><html><head>
    <meta property="og:title" content="New Chameleons in the Cloud Forest" />
    </head><body>
      <header class="SiteHeader_wrapper__FJMJ3"><a class="SubscribeBtn_defaultBtn__sKEfB" href="/products">Subscribe</a></header>
      <article>
        <h1>New Chameleons in the Cloud Forest</h1>
        <p>${wordBlock(45, "forest")} as scientists follow the animals across the ridge.</p>
        <figure><img src="https://assets.nautil.us/article-chameleon.jpg" alt="A chameleon on a branch" /></figure>
        <p>${wordBlock(45, "mist")} as the habitat survey continues.</p>
        <p>The animals face extinction as they are discovered. <img src="https://assets.nautil.us/sites/3/nautilus/nautilus-favicon-14.png?fm=png" alt="" /></p>
        <p><em>Enjoying </em><a href="https://nautil.us/">Nautilus</a><em>? Subscribe to our free </em><a href="/newsletter"><em>newsletter</em></a>.</p>
      </article>
    </body></html>`;

  const cleaned = applyProviderCleanup(
    html,
    mergeProviderCleanup(GENERIC_PROVIDER_CLEANUP, provider.cleanup),
  );
  assertNoProviderNoise(cleaned, [/SubscribeBtn_defaultBtn/i, />Subscribe<\/a>/i]);

  const result = extractArticle(html, "https://nautil.us/new-chameleons-1282292/");
  assert.ok(result, "article should extract");
  assertNoProviderNoise(result!.content, [/nautilus-favicon-14\.png/i, /Enjoying/i, /free newsletter/i]);
  assert.match(result!.content, /article-chameleon\.jpg/i, "article image must survive");
});

test("undark declutter drops newsletter compass promo image and keeps article media", () => {
  const provider = getProvider("undark");
  assert.ok(provider?.cleanup, "Undark cleanup rules must be present");

  const html = `<!doctype html><html><head>
    <meta property="og:title" content="How Animals Care" />
    </head><body><article>
      <h1>How Animals Care</h1>
      <p>${wordBlock(45, "parent")} as researchers describe care across species.</p>
      <figure><img src="https://undark.org/wp-content/uploads/2026/06/orca.jpg" alt="An orca swimming" /></figure>
      <p>${wordBlock(45, "family")} as the reporting follows field observations.</p>
      <hr /><p><img src="https://undark.org/wp-content/uploads/2024/11/compass.png" alt="Newsletter Journeys" /></p><hr />
      <p>${wordBlock(45, "evidence")} as the essay returns to animal behavior.</p>
    </article></body></html>`;

  const result = extractArticle(html, "https://undark.org/2026/06/26/how-animals-care/");
  assert.ok(result, "article should extract");
  assertNoProviderNoise(result!.content, [/compass\.png/i, /Newsletter Journeys/i]);
  assert.match(result!.content, /orca\.jpg/i, "article image must survive");
});

test("technologyreview cleanup drops recirc/signup tail and newsletter promo residue", () => {
  const provider = getProvider("technologyreview");
  assert.ok(provider?.cleanup, "Technology Review cleanup rules must be present");

  const html = `<!doctype html><html><head>
    <meta property="og:title" content="The Download: Heat and AI" />
    </head><body>
      <article>
        <h1>The Download: Heat and AI</h1>
        <p>${wordBlock(45, "heat")} as the daily briefing explains the research.</p>
        <figure><img src="https://wp.technologyreview.com/article-heat.jpg" alt="People in a city heatwave" /></figure>
        <p><strong>This story is from The Checkup, our weekly biotech newsletter. </strong><a href="/newsletters/biotech-the-checkup/"><strong>Sign up</strong></a><strong> to receive it in your inbox every Thursday.</strong></p>
        <p>${wordBlock(45, "policy")} as the second item examines model releases.</p>
        <div class="deepDiveItem__wrapper--abc"><h3>The Download: another recirc story</h3><a href="/author/example"><span>Example Author</span><span class="screen-reader-text">archive page</span></a></div>
        <div class="stayConnected__wrapper--abc"><h3>Stay connected</h3><h2>Get the latest updates from<br/>MIT Technology Review</h2><p>Discover special offers, top stories, upcoming events, and more.</p><p>Thank you for submitting your email!</p><p>It looks like something went wrong.</p></div>
      </article>
    </body></html>`;

  const cleaned = applyProviderCleanup(
    html,
    mergeProviderCleanup(GENERIC_PROVIDER_CLEANUP, provider.cleanup),
  );
  assertNoProviderNoise(cleaned, [/another recirc story/i, /archive page/i, /Stay connected/i]);

  const result = extractArticle(html, "https://www.technologyreview.com/2026/06/26/1139780/the-download-heat-ai/");
  assert.ok(result, "article should extract");
  assertNoProviderNoise(result!.content, [
    /weekly biotech newsletter/i,
    /Sign up/i,
    /another recirc story/i,
    /archive page/i,
    /Stay connected/i,
    /special offers/i,
  ]);
  assert.match(result!.content, /article-heat\.jpg/i, "article image must survive");
});
