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

function requireProviderCleanup(providerKey: string, displayName: string) {
  const cleanup = getProvider(providerKey)?.cleanup;
  assert.ok(cleanup, `${displayName} cleanup rules must be present`);
  return cleanup;
}

function applyGenericProviderCleanup(html: string, cleanup: Parameters<typeof mergeProviderCleanup>[1]): string {
  return applyProviderCleanup(html, mergeProviderCleanup(GENERIC_PROVIDER_CLEANUP, cleanup));
}

function extractContent(html: string, url: string, message: string): string {
  const result = extractArticle(html, url);
  assert.ok(result, message);
  return result!.content;
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

  const content = extractContent(
    html,
    "https://independent.example.org/letters/observatory",
    "unknown-provider newsletter article should extract",
  );
  assert.match(content, /summit1/i, "article prose must survive extraction");
  assert.match(content, /telescope1/i, "middle article prose must survive extraction");
  assert.match(content, /observatory-sky\.jpg/i, "article image must survive extraction");
  assert.match(
    content,
    /https:\/\/independent\.example\.org\/images\/observatory-sky\.jpg/i,
    "relative article image must be absolutized",
  );
});

test("huffpost cleaned HTML drops provider chrome but keeps article image and video link", () => {
  const cleanup = requireProviderCleanup("huffpost", "HuffPost");

  const html = `<!doctype html><html><head>
    <meta property="og:title" content="Orcas Return to Northern Waters" />
    </head><body><article>
      <h1>Orcas Return to Northern Waters</h1>
      <p>${wordBlock(45, "orca")} as researchers document a changing migration.</p>
      <figure><img src="https://img.huffingtonpost.com/orca-breach.jpg" alt="An orca breaching" /></figure>
      <p>The research team also published a <a href="https://www.huffpost.com/video/orca-field-report">field video report</a> for readers.</p>
      <aside class="related"><h2>Related</h2><a href="/other">Another story</a></aside>
      <div class="social-share">Share on Facebook</div>
      <div class="newsletter">Sign up for the morning newsletter</div>
      <div class="promo">Limited time subscription promotion</div>
      <div class="cookie-consent">Accept cookies to continue reading</div>
      <iframe src="https://ads.example/frame"></iframe>
      <p>${wordBlock(45, "habitat")} as conservation crews track the animals.</p>
    </article></body></html>`;

  const cleaned = applyGenericProviderCleanup(html, cleanup);
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

  const content = extractContent(
    html,
    "https://www.huffpost.com/entry/orcas-return-to-northern-waters_l_123abc",
    "article should extract",
  );
  assertNoProviderNoise(content, [
    /Another story/i,
    /Share on/i,
    /newsletter/i,
    /promotion/i,
    /Accept cookies/i,
  ]);
  assert.match(content, /orca-breach\.jpg/i, "article image must survive final extraction");
  assert.match(content, /video\/orca-field-report/i, "article video link must survive final extraction");
});

test("knowable cleaned HTML drops editor/donation/deep-dive remnants but keeps docserver media", () => {
  const cleanup = requireProviderCleanup("knowable", "Knowable");

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

  const cleaned = applyProviderCleanup(html, cleanup);
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
  assert.doesNotMatch(cleaned, /<figcaption/i, "Knowable credit captions must be removed");
});

test("nautilus cleaned extraction drops trailing CTA/favicon and keeps article image", () => {
  const cleanup = requireProviderCleanup("nautilus", "Nautilus");

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

  const cleaned = applyGenericProviderCleanup(html, cleanup);
  assertNoProviderNoise(cleaned, [/SubscribeBtn_defaultBtn/i, />Subscribe<\/a>/i]);

  const content = extractContent(html, "https://nautil.us/new-chameleons-1282292/", "article should extract");
  assertNoProviderNoise(content, [/nautilus-favicon-14\.png/i, /Enjoying/i, /free newsletter/i]);
  assert.match(content, /article-chameleon\.jpg/i, "article image must survive");
});

test("undark declutter drops newsletter compass promo image and keeps article media", () => {
  const cleanup = requireProviderCleanup("undark", "Undark");

  const html = `<!doctype html><html><head>
    <meta property="og:title" content="How Animals Care" />
    </head><body><article>
      <h1>How Animals Care</h1>
      <p>${wordBlock(45, "parent")} as researchers describe care across species.</p>
      <figure><img src="https://undark.org/wp-content/uploads/2026/06/orca.jpg" alt="An orca swimming" /></figure>
      <p>${wordBlock(45, "family")} as the reporting follows field observations.</p>
      <h4>Support Undark Magazine</h4>
      <p>Undark is a non-profit, editorially independent magazine covering science and society. If you would like to help support our journalism, please consider making a donation.</p>
      <p>SIGN UP FOR NEWSLETTER JOURNEYS: Dive deeper into pressing issues with our limited run newsletters, delivered weekly with hand-picked archive excerpts and updates.</p>
      <hr /><p><img src="https://undark.org/wp-content/uploads/2024/11/compass.png" alt="Newsletter Journeys" /></p><hr />
      <p>${wordBlock(45, "evidence")} as the essay returns to animal behavior.</p>
    </article></body></html>`;

  const cleaned = applyGenericProviderCleanup(html, cleanup);
  assertNoProviderNoise(cleaned, [
    /SIGN UP FOR NEWSLETTER JOURNEYS/i,
    /compass\.png/i,
    /Support Undark Magazine/i,
    /non-profit, editorially independent/i,
    /support our journalism/i,
  ]);

  const content = extractContent(html, "https://undark.org/2026/06/26/how-animals-care/", "article should extract");
  assertNoProviderNoise(content, [
    /compass\.png/i,
    /Newsletter Journeys/i,
    /Dive deeper/i,
    /Support Undark Magazine/i,
    /support our journalism/i,
  ]);
  assert.match(content, /orca\.jpg/i, "article image must survive");
});

test("technologyreview cleanup drops recirc/signup tail and newsletter promo residue", () => {
  const cleanup = requireProviderCleanup("technologyreview", "Technology Review");

  const html = `<!doctype html><html><head>
    <meta property="og:title" content="The Download: Heat and AI" />
    </head><body>
      <article>
        <h1>The Download: Heat and AI</h1>
        <p>${wordBlock(45, "heat")} as the daily briefing explains the research.</p>
        <figure><img src="https://wp.technologyreview.com/article-heat.jpg" alt="People in a city heatwave" /><figcaption><em>A visible article caption should remain.</em></figcaption><div class="image-credit">COURTESY OF THE RESEARCHERS</div></figure>
        <p><strong>This story is from The Checkup, our weekly biotech newsletter. </strong><a href="/newsletters/biotech-the-checkup/"><strong>Sign up</strong></a><strong> to receive it in your inbox every Thursday.</strong></p>
        <p>This story originally appeared in The Algorithm, our weekly newsletter on AI. To get stories like this in your inbox first, <a href="/newsletters/the-algorithm/">sign up here</a>.</p>
        <blockquote><a href="https://www.tiktok.com/@absolutemem?refer=embed" rel="noopener noreferrer nofollow" target="_blank">@absolutemem</a></blockquote>
        <p>We’re having trouble saving your preferences. Try refreshing this page and updating them one more time.</p>
        <p>${wordBlock(45, "policy")} as the second item examines model releases.</p>
        <div class="deepDiveItem__wrapper--abc"><h3>The Download: another recirc story</h3><a href="/author/example"><span>Example Author</span><span class="screen-reader-text">archive page</span></a></div>
        <div class="stayConnected__wrapper--abc"><h3>Stay connected</h3><h2>Get the latest updates from<br/>MIT Technology Review</h2><p>Discover special offers, top stories, upcoming events, and more.</p><p>Thank you for submitting your email!</p><p>It looks like something went wrong.</p></div>
      </article>
    </body></html>`;

  const cleaned = applyGenericProviderCleanup(html, cleanup);
  assertNoProviderNoise(cleaned, [
    /weekly biotech newsletter/i,
    /weekly newsletter on AI/i,
    /COURTESY OF THE RESEARCHERS/i,
    /trouble saving your preferences/i,
    /another recirc story/i,
    /archive page/i,
    /Stay connected/i,
  ]);
  assert.match(cleaned, /<figcaption/i, "Technology Review article captions should survive cleanup");
  assert.match(cleaned, /A visible article caption should remain/i, "Technology Review caption text should survive cleanup");

  const content = extractContent(
    html,
    "https://www.technologyreview.com/2026/06/26/1139780/the-download-heat-ai/",
    "article should extract",
  );
  assertNoProviderNoise(content, [
    /weekly biotech newsletter/i,
    /weekly newsletter on AI/i,
    /COURTESY OF THE RESEARCHERS/i,
    /absolutemem/i,
    /tiktok\.com/i,
    /trouble saving your preferences/i,
    /Sign up/i,
    /another recirc story/i,
    /archive page/i,
    /Stay connected/i,
    /special offers/i,
  ]);
  assert.match(content, /article-heat\.jpg/i, "article image must survive");
  assert.match(content, /A visible article caption should remain/i, "article caption must survive");
});

test("jstordaily cleanup preserves social-history articles and drops JSTOR footer residue", () => {
  const cleanup = requireProviderCleanup("jstordaily", "JSTOR Daily");

  const html = `<!doctype html><html><head>
    <title>How Ideas Travel | JSTOR Daily</title>
    <meta property="og:title" content="How Ideas Travel" />
    </head><body>
      <article class="post category-social-history pub_tag-social-work daily_series-shared-collections">
        <h1>How Ideas Travel</h1>
        <div class="j-icon">The <span class="jcitation"></span> icon indicates free access to the linked research on JSTOR.</div>
        <p>${wordBlock(45, "archive")} as the reporting explains how social history shapes public memory.</p>
        <p class="collab-incontent-banner"><a href="https://about.jstor.org/collaborate-with-jstor/"><img src="https://daily.jstor.org/wp-content/uploads/2025/05/jstor_collaborators_ad_in_text.jpg" alt="Collaborate" /><img src="https://daily.jstor.org/wp-content/uploads/2025/05/jstor_collaborators_ad_mobile.jpg" alt="Collaborate" /></a></p>
        <div class="social-share">Share this article</div>
        <p>${wordBlock(45, "evidence")} as the essay follows scholarship across archives.</p>
        <p>JSTOR is a digital library for scholars, researchers, and students. JSTOR Daily readers can access the original research behind our articles for free on JSTOR.</p>
        <p>${wordBlock(45, "reader")} as the conclusion returns to the historical argument.</p>
        <div class="article-citations-container">
          <div class="jstor-logo"><img src="/wp-content/uploads/2018/02/jstor-logo@2x.png" alt="JSTOR logo" /></div>
          <div class="article-citations"><h2>Resources</h2><p>Research links and citation chrome.</p></div>
        </div>
      </article>
      <footer>
        <p>JSTOR Daily provides context for current events using scholarship found in JSTOR, a digital library of academic journals, books, and other material.</p>
        <p>JSTOR is part of ITHAKA, a not-for-profit organization helping the academic community preserve the scholarly record.</p>
      </footer>
    </body></html>`;

  const cleaned = applyGenericProviderCleanup(html, cleanup);
  assert.match(cleaned, /archive1/i, "article prose in social-history wrapper must survive cleanup");
  assert.match(cleaned, /evidence1/i, "middle article prose must survive cleanup");
  assertNoProviderNoise(cleaned, [
    /icon indicates free access/i,
    /jstor_collaborators_ad/i,
    /collaborate-with-jstor/i,
    /Share this article/i,
    /JSTOR is a digital library for scholars/i,
    /jstor-logo@2x/i,
    /Research links and citation chrome/i,
    /JSTOR Daily provides context/i,
    /JSTOR is part of ITHAKA/i,
  ]);

  const content = extractContent(
    html,
    "https://daily.jstor.org/how-ideas-travel/",
    "JSTOR Daily article should extract",
  );
  assert.match(content, /archive1/i, "article prose must survive final extraction");
  assert.match(content, /reader1/i, "article tail prose must survive final extraction");
  assertNoProviderNoise(content, [
    /icon indicates free access/i,
    /jstor_collaborators_ad/i,
    /collaborate-with-jstor/i,
    /Share this article/i,
    /JSTOR is a digital library for scholars/i,
    /jstor-logo@2x/i,
    /Research links and citation chrome/i,
    /JSTOR Daily provides context/i,
    /JSTOR is part of ITHAKA/i,
  ]);
});

test("wired cleanup drops exact recirc/newsletter residue while preserving prose", () => {
  const cleanup = requireProviderCleanup("wired", "WIRED");

  const html = `<!doctype html><html><head>
    <meta property="og:title" content="Fungi Map the Future" />
    </head><body><article>
      <h1>Fungi Map the Future</h1>
      <p>${wordBlock(45, "mycelium")} as scientists compare soil networks across continents.</p>
      <p>More Great WIRED Stories</p>
      <figure><img src="https://media.wired.com/photos/fungi.jpg" alt="A network of fungi" /></figure>
      <p>${wordBlock(45, "forest")} as the map changes how researchers understand ecosystems.</p>
      <p>This is an edition of the Inner Loop newsletter. Read previous newsletters here.</p>
      <p>${wordBlock(45, "climate")} as the reporting returns to the larger climate stakes.</p>
    </article></body></html>`;

  const cleaned = applyGenericProviderCleanup(html, cleanup);
  assertNoProviderNoise(cleaned, [
    /More Great WIRED Stories/i,
    /Inner Loop newsletter/i,
    /previous newsletters/i,
  ]);
  assert.match(cleaned, /fungi\.jpg/i, "article image must survive cleanup");

  const content = extractContent(
    html,
    "https://www.wired.com/story/theres-a-global-network-of-fungi-under-your-feet-this-is-the-first-complete-map/",
    "article should extract",
  );
  assertNoProviderNoise(content, [
    /More Great WIRED Stories/i,
    /Inner Loop newsletter/i,
    /previous newsletters/i,
  ]);
  assert.match(content, /fungi\.jpg/i, "article image must survive final extraction");
  assert.match(content, /mycelium1/i, "article prose must survive final extraction");
  assert.match(content, /climate1/i, "article tail prose must survive final extraction");

  const articleBody = [
    `${wordBlock(45, "network")} as the structured article body describes the actual reporting.`,
    "More Great WIRED Stories",
    `${wordBlock(45, "archive")} as the middle section keeps the reader focused on evidence.`,
    "This is an edition of the Inner Loop newsletter. Read previous newsletters here.",
    `${wordBlock(45, "future")} as the final section explains why the finding matters.`,
  ].join("\n\n");
  const jsonLd = {
    "@type": "Article",
    headline: "Fungi Map the Future",
    author: { name: "Example Reporter" },
    datePublished: "2026-07-05T11:00:00Z",
    image: "https://media.wired.com/photos/fungi.jpg",
    articleBody,
  };
  const jsonLdHtml = `<!doctype html><html><head>
    <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
    </head><body><main><p>Fallback page shell.</p></main></body></html>`;
  const jsonLdContent = extractContent(
    jsonLdHtml,
    "https://www.wired.com/story/theres-a-global-network-of-fungi-under-your-feet-this-is-the-first-complete-map/",
    "JSON-LD article should extract",
  );
  assertNoProviderNoise(jsonLdContent, [
    /More Great WIRED Stories/i,
    /Inner Loop newsletter/i,
    /previous newsletters/i,
  ]);
  assert.match(jsonLdContent, /network1/i, "JSON-LD article prose must survive");
  assert.match(jsonLdContent, /future1/i, "JSON-LD article tail prose must survive");

  const collapsedJsonLd = {
    ...jsonLd,
    articleBody: [
      `${wordBlock(45, "collapsed")} as the structured body is one long paragraph.`,
      `${wordBlock(45, "flattened")} as the source page still has real paragraphs.`,
      `${wordBlock(45, "structured")} as Readability should preserve those paragraphs.`,
    ].join(" "),
  };
  const structuredHtml = `<!doctype html><html><head>
    <title>Fungi Map the Future | WIRED</title>
    <meta property="og:title" content="Fungi Map the Future" />
    <script type="application/ld+json">${JSON.stringify(collapsedJsonLd)}</script>
    </head><body><article>
      <h1>Fungi Map the Future</h1>
      <p>${wordBlock(45, "collapsed")} as the source page first paragraph remains distinct.</p>
      <p>${wordBlock(45, "flattened")} as the source page second paragraph remains distinct.</p>
      <p>${wordBlock(45, "structured")} as the source page third paragraph remains distinct.</p>
    </article></body></html>`;
  const structuredContent = extractContent(
    structuredHtml,
    "https://www.wired.com/story/theres-a-global-network-of-fungi-under-your-feet-this-is-the-first-complete-map/",
    "Wired structured page should extract",
  );
  assert.ok(
    (structuredContent.match(/<p\b/gi) ?? []).length >= 3,
    "Wired extraction should preserve page paragraph structure when JSON-LD is collapsed",
  );
});
