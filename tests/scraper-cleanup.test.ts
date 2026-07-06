/**
 * Tests for provider-level pre-extraction cleanup (Epic #366 / Issue #367).
 *
 * All tests use local HTML fixtures — no real network or DB is touched.
 * The `applyProviderCleanup` function uses sanitize-html under the hood, so
 * we test tag-dropping (`dropSelectors`) and keyword-matching
 * (`dropClassKeywords`, `dropTextKeywords`) paths.
 */
process.env.LOG_LEVEL = "error";

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GENERIC_PROVIDER_CLEANUP,
  applyProviderCleanup,
  mergeProviderCleanup,
} from "@/lib/scraper/cleanup";
import { getProvider } from "@/lib/scraper/providers";
import { sanitizeArticleHtml } from "@/lib/sanitize";

function providerCleanup(providerId: string, label: string) {
  const cleanup = getProvider(providerId)?.cleanup;
  assert.ok(cleanup, `${label} cleanup rules must be present`);
  return cleanup;
}

function applyMergedProviderCleanup(providerId: string, label: string, html: string) {
  return applyProviderCleanup(
    html,
    mergeProviderCleanup(GENERIC_PROVIDER_CLEANUP, providerCleanup(providerId, label)),
  );
}

function plainText(html: string): string {
  return sanitizeArticleHtml(html).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// dropSelectors: tag-based removal
// ---------------------------------------------------------------------------

test("cleanup: removes <video> blocks with all inner content", () => {
  const html =
    "<p>Main content here.</p>" +
    '<video src="x.mp4" controls><source src="x.mp4" type="video/mp4"/>Fallback text</video>' +
    "<p>More content after video.</p>";
  const result = applyProviderCleanup(html, { dropSelectors: ["video"] });
  assert.doesNotMatch(result, /<video/i, "video tag should be removed");
  assert.doesNotMatch(result, /x\.mp4/, "video src should be removed");
  assert.doesNotMatch(result, /Fallback text/, "video inner content should be removed");
  assert.match(result, /Main content here/);
  assert.match(result, /More content after video/);
});

test("cleanup: removes <iframe> blocks with all inner content", () => {
  const html =
    "<p>Text before iframe.</p>" +
    '<iframe src="https://ads.example.com" width="300">iframe fallback</iframe>' +
    "<p>Text after iframe.</p>";
  const result = applyProviderCleanup(html, { dropSelectors: ["iframe"] });
  assert.doesNotMatch(result, /<iframe/i, "iframe tag should be removed");
  assert.doesNotMatch(result, /ads\.example\.com/, "iframe src should be removed");
  assert.doesNotMatch(result, /iframe fallback/, "iframe inner content should be removed");
  assert.match(result, /Text before iframe/);
  assert.match(result, /Text after iframe/);
});

test("cleanup: removes <aside> blocks with all inner content", () => {
  const html =
    "<p>Article body.</p>" +
    '<aside class="promo"><h3>Promo heading</h3><p>Promo paragraph</p></aside>' +
    "<p>Conclusion.</p>";
  const result = applyProviderCleanup(html, { dropSelectors: ["aside"] });
  assert.doesNotMatch(result, /<aside/i);
  assert.doesNotMatch(result, /Promo heading/);
  assert.doesNotMatch(result, /Promo paragraph/);
  assert.match(result, /Article body/);
  assert.match(result, /Conclusion/);
});

test("cleanup: removes multiple different tag types in one pass", () => {
  const html =
    "<p>Content.</p>" +
    '<video src="v.mp4"></video>' +
    '<iframe src="i.html"></iframe>' +
    '<aside class="sidebar">Sidebar</aside>' +
    "<p>End.</p>";
  const result = applyProviderCleanup(html, { dropSelectors: ["video", "iframe", "aside"] });
  assert.doesNotMatch(result, /<video/i);
  assert.doesNotMatch(result, /<iframe/i);
  assert.doesNotMatch(result, /<aside/i);
  assert.doesNotMatch(result, /Sidebar/);
  assert.match(result, /Content/);
  assert.match(result, /End/);
});

test("cleanup: hakai drops template labels, byline, citation, social, and related blocks", () => {
  const html =
    '<section class="singlebyline singlepagecontainer"><h3 class="invis">Authored by</h3> by <a href="/profiles/writer/">Writer Name</a><br /></section>' +
    '<aside class="singlebydatewords singlepagecontainer"><h3 class="invis">Wordcount</h3> July 1, 2026 | 1,000 words</aside>' +
    '<aside class="social-sharing"><h4>Share</h4><a href="https://facebook.example/share">Facebook</a></aside>' +
    '<section class="maincontent singlepagecontainer"><h3 class="invis">Article body copy</h3><p>Important coastal reporting remains intact.</p></section>' +
    '<video autoplay loop muted playsinline class="gif-video"><source src="coast.mp4" type="video/mp4" /><p>Your browser does not support the video element.</p></video>' +
    "<p>Coastal reporting video caption remains intact.</p>" +
    '<p><em>This article is also available in audio format. Listen now, <a href="https://mcdn.podbean.com/story.mp3">download</a>, or subscribe to “Hakai Magazine Audio Edition” through your favorite podcast app.</em></p>' +
    '<p><em><img src="https://hakaimagazine.com/wp-content/uploads/sandpiper.png" alt="" />This article is the second in a two-part series. The first installment was “<a href="/features/slime-shorebirds-and-scientific-mystery/">Slime, Shorebirds, and a Scientific Mystery.</a>”</em></p>' +
    '<p><em>*The Hakai Institute and </em>Hakai Magazine<em> are both part of the Tula Foundation. The magazine is <a href="/tula-foundation/">editorially independent</a> of the institute and foundation.</em></p>' +
    '<p>Read our follow-up story, “<a href="/features/the-details-are-in-the-devils-tumors/">The Details Are in the Devil’s Tumors</a>,” published in 2023.</p>' +
    '<p><em>Reporting for this story was supported by the <a href="http://pulitzercenter.org/">Pulitzer Center on Crisis Reporting</a>.</em></p>' +
    '<footer class="singlepagecontainer"><h3 class="invis">Article footer and bottom matter</h3><section class="main cite printonly"><h3 class="invis">Cite this Article:</h3><p>Cite this Article: Writer Name, Hakai Magazine.</p></section></footer>' +
    '<aside class="main relatedcontent"><h3>Related Content</h3><p>Another story teaser</p></aside>';

  const result = applyMergedProviderCleanup("hakaimagazine", "Hakai", html);
  const text = plainText(result);

  assert.match(text, /Important coastal reporting remains intact/);
  assert.match(text, /Coastal reporting video caption remains intact/);
  assert.doesNotMatch(text, /Authored by|Writer Name|Wordcount|Share|Article body copy/i);
  assert.doesNotMatch(text, /Your browser does not support the video element|audio format/i);
  assert.doesNotMatch(text, /two-part series|first installment|Tula Foundation|editorially independent/i);
  assert.doesNotMatch(text, /follow-up story|Details Are in the Devil|Pulitzer Center|Crisis Reporting/i);
  assert.doesNotMatch(text, /Article footer and bottom matter|Cite this Article|Related Content|Another story teaser/i);
});

// ---------------------------------------------------------------------------
// dropClassKeywords: class/id keyword-based removal
// ---------------------------------------------------------------------------

test("cleanup: removes newsletter block matched by class keyword", () => {
  const html =
    "<p>Article text.</p>" +
    '<div class="newsletter-signup"><h3>Subscribe!</h3><form><input/><button>Join</button></form></div>' +
    "<p>Conclusion.</p>";
  const result = applyProviderCleanup(html, { dropClassKeywords: ["newsletter"] });
  assert.doesNotMatch(result, /Subscribe!/, "newsletter heading should be removed");
  assert.doesNotMatch(result, /newsletter/i, "newsletter class should be removed");
  assert.match(result, /Article text/);
  assert.match(result, /Conclusion/);
});

test("cleanup: removes related-articles block matched by class keyword", () => {
  const html =
    "<p>Intro paragraph.</p>" +
    '<section class="related-articles"><h2>See also</h2><a href="/other">Other story</a></section>' +
    "<p>Main body paragraph.</p>";
  const result = applyProviderCleanup(html, { dropClassKeywords: ["related"] });
  assert.doesNotMatch(result, /See also/);
  assert.doesNotMatch(result, /Other story/);
  assert.match(result, /Intro paragraph/);
  assert.match(result, /Main body paragraph/);
});

test("cleanup: removes social-share block matched by class keyword", () => {
  const html =
    "<p>Content here.</p>" +
    '<div class="social-share"><a>Share on Twitter</a><a>Share on Facebook</a></div>' +
    "<p>Ending here.</p>";
  const result = applyProviderCleanup(html, { dropClassKeywords: ["social"] });
  assert.doesNotMatch(result, /Share on Twitter/);
  assert.doesNotMatch(result, /Share on Facebook/);
  assert.match(result, /Content here/);
  assert.match(result, /Ending here/);
});

test("cleanup: removes promo block matched by class keyword", () => {
  const html =
    "<p>Article content.</p>" +
    '<div class="promo-banner"><p>Special offer — buy now!</p></div>' +
    "<p>More content.</p>";
  const result = applyProviderCleanup(html, { dropClassKeywords: ["promo"] });
  assert.doesNotMatch(result, /Special offer/);
  assert.doesNotMatch(result, /buy now/);
  assert.match(result, /Article content/);
  assert.match(result, /More content/);
});

test("cleanup: removes advertisement block matched by id keyword", () => {
  const html =
    "<p>Text before ad.</p>" +
    '<div id="ad-container"><p>Advertisement content</p></div>' +
    "<p>Text after ad.</p>";
  const result = applyProviderCleanup(html, { dropClassKeywords: ["ad"] });
  assert.doesNotMatch(result, /Advertisement content/);
  assert.match(result, /Text before ad/);
  assert.match(result, /Text after ad/);
});

test("cleanup: generic rules remove common recirculation/newsletter/share chrome", () => {
  const html =
    "<p>Article text.</p>" +
    '<section data-testid="recirc-related"><h2>More like this</h2><a href="/other">Other story</a></section>' +
    '<div aria-label="share this article"><a>Share on Facebook</a></div>' +
    '<div class="paywall-newsletter"><p>Subscribe to our daily newsletter.</p></div>' +
    '<p>Article ending.</p>';
  const result = applyProviderCleanup(html, GENERIC_PROVIDER_CLEANUP);
  assert.doesNotMatch(result, /Other story/);
  assert.doesNotMatch(result, /Share on Facebook/);
  assert.doesNotMatch(result, /daily newsletter/);
  assert.match(result, /Article text/);
  assert.match(result, /Article ending/);
});

test("cleanup: generic rules preserve article body containers named inline-promos", () => {
  const html =
    "<article>" +
    '<div class="article-body inline-promos">' +
    "<p>Reported article prose that should never be treated as promotional chrome.</p>" +
    "</div>" +
    '<aside class="newsletter-signup">Sign up for the newsletter</aside>' +
    "</article>";

  const result = applyProviderCleanup(html, GENERIC_PROVIDER_CLEANUP);

  assert.match(result, /Reported article prose/);
  assert.doesNotMatch(result, /newsletter-signup/);
});

test("cleanup: mergeProviderCleanup combines generic and provider rules once", () => {
  const merged = mergeProviderCleanup(GENERIC_PROVIDER_CLEANUP, {
    dropSelectors: ["iframe"],
    dropClassKeywords: ["newsletter", "site-specific"],
    dropTextKeywords: ["site-specific text"],
    dropTextExactKeywords: ["--"],
    dropLinkHrefKeywords: ["promo_name="],
    dropLinkHrefBlockKeywords: ["/getsciam/"],
    dropFigcaptions: true,
    dropEmptyImageOnlyFigures: true,
  });
  assert.ok(merged.dropSelectors?.includes("iframe"));
  assert.ok(merged.dropClassKeywords?.includes("newsletter"));
  assert.ok(merged.dropClassKeywords?.includes("site-specific"));
  assert.ok(merged.dropTextKeywords?.includes("site-specific text"));
  assert.ok(merged.dropTextExactKeywords?.includes("--"));
  assert.ok(merged.dropLinkHrefKeywords?.includes("promo_name="));
  assert.ok(merged.dropLinkHrefBlockKeywords?.includes("/getsciam/"));
  assert.equal(merged.dropFigcaptions, true);
  assert.equal(merged.dropEmptyImageOnlyFigures, true);
  assert.equal(
    merged.dropClassKeywords?.filter((keyword) => keyword === "newsletter").length,
    1,
  );
});

test("cleanup: removes empty image-only figures when provider opts in", () => {
  const html =
    "<article>" +
    "<p>Article opening text.</p>" +
    '<figure><img src="logo.png" alt="" /></figure>' +
    '<figure><img src="diagram.png" alt="Meaningful diagram" /></figure>' +
    '<figure><img src="photo.png" alt="" /><figcaption>Meaningful caption.</figcaption></figure>' +
    "<p>Article ending text.</p>" +
    "</article>";

  const result = applyProviderCleanup(html, { dropEmptyImageOnlyFigures: true });

  assert.match(result, /Article opening text/);
  assert.match(result, /Article ending text/);
  assert.doesNotMatch(result, /logo\.png/);
  assert.match(result, /diagram\.png/);
  assert.match(result, /photo\.png/);
  assert.match(result, /Meaningful caption/);
});

test("cleanup: removes short blocks matched by provider text keyword", () => {
  const html =
    "<article>" +
    "<p>Article opening text.</p>" +
    "<p>Provider Branded Signup: read more from this site every week.</p>" +
    "<p>Article ending text.</p>" +
    "</article>";
  const result = applyProviderCleanup(html, { dropTextKeywords: ["branded signup"] });
  assert.doesNotMatch(result, /Provider Branded Signup/i);
  assert.match(result, /Article opening text/);
  assert.match(result, /Article ending text/);
});

test("cleanup: removes exact text blocks without matching prose substrings", () => {
  const html =
    "<article>" +
    "<p>Article opening text.</p>" +
    "<p>--</p>" +
    "<p>A real sentence can use -- as punctuation and must stay.</p>" +
    "<p>Article ending text.</p>" +
    "</article>";
  const result = applyProviderCleanup(html, { dropTextExactKeywords: ["--"] });

  assert.match(result, /Article opening text/);
  assert.match(result, /A real sentence can use -- as punctuation/);
  assert.match(result, /Article ending text/);
  assert.doesNotMatch(result, /<p>\s*--\s*<\/p>/);
});

test("cleanup: text keyword matching is conservative for long prose blocks", () => {
  const longText = Array.from({ length: 180 }, () => "article").join(" ");
  const html = `<p>${longText} branded signup ${longText}</p>`;
  const result = applyProviderCleanup(html, { dropTextKeywords: ["branded signup"] });
  assert.match(result, /branded signup/);
});

test("cleanup: removes anchors matched by href keyword and empty wrappers", () => {
  const html =
    "<article>" +
    "<p>Article text.</p>" +
    '<p><a href="https://example.com/subscribe?promo_name=current-issue"><img src="cover.jpg" alt="Cover"/></a></p>' +
    '<figure><a href="https://example.com/article"><img src="real.jpg" alt="Real"/></a><figcaption>Real caption.</figcaption></figure>' +
    "</article>";
  const result = applyProviderCleanup(html, { dropLinkHrefKeywords: ["PROMO_NAME="] });
  assert.doesNotMatch(result, /cover\.jpg/);
  assert.doesNotMatch(result, /promo_name/);
  assert.doesNotMatch(result, /<p>\s*<\/p>/);
  assert.match(result, /real\.jpg/);
  assert.match(result, /Real caption/);
});

test("cleanup: removes short blocks matched by href keyword and adjacent promo chrome", () => {
  const html =
    "<article>" +
    "<p>Article opening text.</p>" +
    "<hr>" +
    "<h2>Keep independent reporting alive</h2>" +
    '<p>Become a supporter by <a href="/getsciam/">joining</a> today. Your subscription helps our newsroom.</p>' +
    "<hr>" +
    "<p>Article ending text.</p>" +
    "</article>";
  const result = applyProviderCleanup(html, { dropLinkHrefBlockKeywords: ["/getsciam/"] });

  assert.match(result, /Article opening text/);
  assert.match(result, /Article ending text/);
  assert.doesNotMatch(result, /independent reporting/i);
  assert.doesNotMatch(result, /Your subscription helps/i);
  assert.doesNotMatch(result, /getsciam/i);
});

test("cleanup: href block matching is conservative for long prose blocks", () => {
  const longText = Array.from({ length: 260 }, () => "article").join(" ");
  const html = `<p>${longText} <a href="/getsciam/">subscription history</a> ${longText}</p>`;
  const result = applyProviderCleanup(html, { dropLinkHrefBlockKeywords: ["/getsciam/"] });

  assert.match(result, /subscription history/);
  assert.match(result, /getsciam/);
});

test("cleanup: propublica removes republish license modal while preserving article prose", () => {
  const html =
    "<article>" +
    "<p>Reported article prose should stay in the extracted body.</p>" +
    '<div class="wp-block-propublica-republish-link">' +
    "<button>Republish This Story</button>" +
    '<div class="wp-block-propublica-republish-link__modal">' +
    "<h2>Republish This Story for Free</h2>" +
    "<p>Creative Commons License (CC BY-NC-ND 3.0)</p>" +
    "<p>Thank you for your interest in republishing this story. You are free to republish it so long as you do the following.</p>" +
    "</div>" +
    "</div>" +
    "<p>More reported article prose should stay.</p>" +
    "</article>";
  const result = applyMergedProviderCleanup("propublica", "ProPublica", html);

  assert.match(result, /Reported article prose/);
  assert.match(result, /More reported article prose/);
  assert.doesNotMatch(result, /Republish This Story/i);
  assert.doesNotMatch(result, /Creative Commons License/i);
  assert.doesNotMatch(result, /republishing this story/i);
});

test("cleanup: Atlas Obscura removes short internal newsletter CTA link blocks", () => {
  const html =
    "<article>" +
    "<p>Reported Atlas Obscura prose should stay in the extracted body.</p>" +
    '<p><em>Sign up for a site newsletter with <a href="/newsletters/gastro-obscura">this link</a>.</em></p>' +
    "<p>More Atlas Obscura prose should stay.</p>" +
    "</article>";

  const result = applyMergedProviderCleanup("atlasobscura", "Atlas Obscura", html);

  assert.match(result, /Reported Atlas Obscura prose/);
  assert.match(result, /More Atlas Obscura prose/);
  assert.doesNotMatch(result, /site newsletter/i);
  assert.doesNotMatch(result, /\/newsletters\/gastro-obscura/i);
});

test("cleanup: Atlas Obscura preserves long prose that references newsletter links", () => {
  const longText = Array.from({ length: 260 }, () => "reported").join(" ");
  const html =
    "<article>" +
    `<p>${longText} <a href="/newsletters/gastro-obscura">newsletter archives</a> ${longText}</p>` +
    "</article>";

  const result = applyMergedProviderCleanup("atlasobscura", "Atlas Obscura", html);

  assert.match(result, /newsletter archives/);
  assert.match(result, /\/newsletters\/gastro-obscura/);
});

test("cleanup: Atlas Obscura removes article header, breadcrumbs, and book interrupt cards", () => {
  const html =
    "<article>" +
    '<div class="stories-breadcrumb-wrapper"><a href="/articles">Stories</a> Watch a Man Walk His Pet Tortoise Around the Streets of Tokyo</div>' +
    '<header class="ArticleHeader js-item-header ArticleHeader--">' +
    "<h1>Watch a Man Walk His Pet Tortoise Around the Streets of Tokyo</h1>" +
    "<h2>They’re not the fastest pair there ever was.</h2>" +
    "<p>by David Doochin July 15, 2016</p>" +
    "</header>" +
    '<div id="articleBody__interrupt-card" class="hidden-print">' +
    '<strong class="article-gastro-heading">ATLAS OBSCURA BOOKS</strong>' +
    '<div class="article-gastro-subheading">A Visual Odyssey Through the Marvels of Life</div>' +
    '<p>Venture into Nature&apos;s Unseen Realms with Our New Book <em>Atlas Obscura: Wild Life</em> <a href="https://wildlife.atlasobscura.com/?utm_medium=article_interrupt">Order Now</a></p>' +
    '<img alt="Gastro Obscura Book" src="book.jpg">' +
    "</div>" +
    "<p>Real Atlas story prose should remain.</p>" +
    "</article>";

  const result = applyMergedProviderCleanup("atlasobscura", "Atlas Obscura", html);

  assert.match(result, /Real Atlas story prose/);
  assert.doesNotMatch(result, /Stories/i);
  assert.doesNotMatch(result, /They’re not the fastest/i);
  assert.doesNotMatch(result, /David Doochin/i);
  assert.doesNotMatch(result, /ATLAS OBSCURA BOOKS/i);
  assert.doesNotMatch(result, /Visual Odyssey/i);
  assert.doesNotMatch(result, /book\.jpg/i);
});

test("cleanup: Atlas Obscura removes recurring series, signup, correction, and attribution boilerplate", () => {
  const html =
    "<article>" +
    "<p>Real Atlas story prose should remain.</p>" +
    "<p><em>Every day we track down a Video Wonder: an audiovisual offering that delights, inspires, and entertains. Have you encountered a video we should feature?</em></p>" +
    "<p><em>Naturecultures is a weekly column that explores the changing relationships between humanity and wilder things. Have something you want covered?</em></p>" +
    "<p><em>Map Monday highlights interesting and unusual cartographic pursuits from around the world and through time. <a href=\"/categories/map-monday\">Read more Map Monday posts.</a></em></p>" +
    '<p><strong><a href="http://atlasobscura.us1.list-manage.com/subscribe?u=1">Sign up here to explore Illinois and Chicago’s most curious locations with Atlas Obscura.</a></strong></p>' +
    "<p><em>Illinois Week on Atlas Obscura was created in partnership with Enjoy Illinois as part of the launch of the new Illinois Obscura Society. Sign up to find out more.</em></p>" +
    '<p><em><a href="http://www.enjoyillinois.com/tripideas/offbeat?utm_source=Atlas%20Obscura%20%20&amp;utm_medium=click%20thru"><img src="enjoy-illinois-logo.jpg" alt=""></a></em></p>' +
    "<p><em>Update, 12/4: An early version of this article misstated an affiliation. We regret the error.</em></p>" +
    "<p><em>*Update 1/23: This post has been updated with more information about a source.</em></p>" +
    "<p><em>* Update 9/20/20: This story was updated to reflect recent historical research.</em></p>" +
    '<p><em>A version of this post originally appeared on <a href="http://tedium.co/">Tedium</a>, a twice-weekly newsletter that hunts for the end of the long tail.</em></p>' +
    '<figure><img src="tedium-logo.png" alt="" /></figure>' +
    "<p>More real Atlas story prose should remain.</p>" +
    "</article>";

  const result = applyMergedProviderCleanup("atlasobscura", "Atlas Obscura", html);

  assert.match(result, /Real Atlas story prose/);
  assert.match(result, /More real Atlas story prose/);
  assert.doesNotMatch(result, /Video Wonder/i);
  assert.doesNotMatch(result, /Naturecultures/i);
  assert.doesNotMatch(result, /Map Monday highlights/i);
  assert.doesNotMatch(result, /list-manage/i);
  assert.doesNotMatch(result, /Illinois Week/i);
  assert.doesNotMatch(result, /enjoyillinois/i);
  assert.doesNotMatch(result, /enjoy-illinois-logo\.jpg/i);
  assert.doesNotMatch(result, /regret the error/i);
  assert.doesNotMatch(result, /updated with more information/i);
  assert.doesNotMatch(result, /updated to reflect/i);
  assert.doesNotMatch(result, /Tedium/i);
  assert.doesNotMatch(result, /tedium-logo\.png/i);
});

test("cleanup: bbcfeatures removes navigation drawer search and footer chrome", () => {
  const html =
    "<article>" +
    "<p>BBC Features article prose should remain readable.</p>" +
    "</article>" +
    '<div class="Drawer-styles__DrawerBackgroundStyled-sc-211ba7ec-0" data-testid="drawer-background">' +
    '<div class="NavigationPanel-styles__DrawerContentStyled-sc-f752c3ab-0">' +
    '<div class="SearchInput-styles__SearchInputWrapperStyled-sc-50f6a0bc-0" data-testid="search-input-wrapper">' +
    "<label><span>Site search</span></label>" +
    "</div>" +
    '<a href="https://www.bbc.com/newsletters"><button>Newsletters</button></a>' +
    "</div>" +
    "</div>" +
    '<footer id="bbc-footer" data-testid="main-footer">' +
    "<p>BBC is not responsible for the content of external sites.</p>" +
    "</footer>";
  const result = applyMergedProviderCleanup("bbcfeatures", "BBC Features", html);

  assert.match(result, /BBC Features article prose/);
  assert.doesNotMatch(result, /Site search/i);
  assert.doesNotMatch(result, /Newsletters/i);
  assert.doesNotMatch(result, /BBC is not responsible/i);
  assert.doesNotMatch(result, /bbc-footer/i);
});

test("cleanup: bbcfeatures removes empty image pid placeholder text blocks", () => {
  const html =
    "<article>" +
    "<p>BBC Features article prose should stay.</p>" +
    '<p><i id="{&quot;image&quot;:{&quot;pid&quot;:&quot;&quot;}}">{"image":{"pid":""}}</i></p>' +
    "<p>Final BBC Features article prose should also stay.</p>" +
    "</article>";
  const result = applyMergedProviderCleanup("bbcfeatures", "BBC Features", html);

  assert.match(result, /BBC Features article prose should stay/);
  assert.match(result, /Final BBC Features article prose/);
  assert.doesNotMatch(result, /\{"image":\{"pid":""\}\}/);
});

test("cleanup: bbcfeatures removes trailing dash separators and newsletter CTA blocks", () => {
  const html =
    "<article>" +
    "<p>BBC Features article prose should stay.</p>" +
    "<p>--</p>" +
    "<p>---</p>" +
    '<p>And if you liked this story, <a href="http://pages.emails.bbc.com/subscribe/"></a>, called "If You Only Read 6 Things This Week". A handpicked selection of stories from BBC Future, Earth, Culture, Capital, Travel and Autos, delivered to your inbox every Friday.</p>' +
    "<p>Join one million Future fans by liking us on Facebook.</p>" +
    "</article>";
  const result = applyMergedProviderCleanup("bbcfeatures", "BBC Features", html);

  assert.match(result, /BBC Features article prose should stay/);
  assert.doesNotMatch(result, /<p>\s*--\s*<\/p>/);
  assert.doesNotMatch(result, /<p>\s*---\s*<\/p>/);
  assert.doesNotMatch(result, /delivered to your inbox every Friday/i);
  assert.doesNotMatch(result, /If You Only Read 6 Things/i);
  assert.doesNotMatch(result, /Join one million Future fans/i);
});

test("cleanup: bbcfeatures removes raw text-block social, series, and safety note residue", () => {
  const html =
    "<article>" +
    '<div data-component="text-block"><p>BBC Features article prose should stay.</p></div>' +
    '<div data-component="text-block"><p><i>BBC.com&#x27;s </i><a href="https://www.bbc.com/travel/worlds-table">World&#x27;s Table</a><i> "smashes the kitchen ceiling" by changing the way the world thinks about food, through the past, present and future.</i></p></div>' +
    '<div data-component="text-block"><p><a href="http://www.bbc.com/travel/columns/why-we-are-what-we-are">Why We Are What We Are</a> <i>is a BBC Travel series examining the characteristics of a country and investigating whether they are true.</i></p></div>' +
    '<div data-component="text-block"><p><a href="http://www.bbc.com/travel/columns/the-ritual-of-eating">The Ritual of Eating</a> <i>is a BBC Travel series that explores interesting culinary rituals and food etiquette around the world.</i></p></div>' +
    '<div data-component="text-block"><p><i>Love film and TV? Join </i><a href="https://www.facebook.com/groups/440074069852291/">BBC Culture Film and TV Club</a><i> on Facebook, a community for cinephiles all over the world.</i></p></div>' +
    '<div data-component="text-block"><p><a href="https://www.facebook.com/pages/BBC-Culture/237388053065908">Facebook</a><i> page or message us on </i><a href="https://twitter.com/bbc_culture">Twitter</a><i>.</i></p></div>' +
    '<div data-component="text-block"><p><a href="http://www.bbc.com/travel/columns/culinary-roots">Culinary Roots</a><i> is a series from BBC Travel connecting to the rare and local foods woven into a place’s heritage.</i></p></div>' +
    '<div data-component="text-block"><p><i>This article is for information only. When venturing into "bear country", always check with local authorities for the most locally relevant information.</i></p></div>' +
    '<div data-component="text-block"><p><i><b>CORRECTION:</b></i><i> A previous version of this article incorrectly stated that tourists introduced avian flu to Antarctica. This has now been corrected.</i></p></div>' +
    '<div data-component="text-block"><p><i>Join more than three million BBC Travel fans by liking us on </i><a href="https://www.facebook.com/BBCTravel/">Facebook</a><i>, or follow us on </i><a href="https://twitter.com/BBC_Travel">Twitter</a><i> and Instagram.</i></p></div>' +
    '<div data-component="text-block"><p>Final BBC Features article prose should also stay.</p></div>' +
    "</article>";
  const result = applyMergedProviderCleanup("bbcfeatures", "BBC Features", html);

  assert.match(result, /BBC Features article prose should stay/);
  assert.match(result, /Final BBC Features article prose should also stay/);
  assert.doesNotMatch(result, /World&#x27;s Table|World's Table/i);
  assert.doesNotMatch(result, /smashes the kitchen ceiling/i);
  assert.doesNotMatch(result, /Why We Are What We Are/i);
  assert.doesNotMatch(result, /The Ritual of Eating/i);
  assert.doesNotMatch(result, /is a BBC Travel series/i);
  assert.doesNotMatch(result, /BBC Culture Film and TV Club/i);
  assert.doesNotMatch(result, /message us on/i);
  assert.doesNotMatch(result, /Culinary Roots/i);
  assert.doesNotMatch(result, /bear country/i);
  assert.doesNotMatch(result, /CORRECTION:/i);
  assert.doesNotMatch(result, /previous version of this article/i);
  assert.doesNotMatch(result, /three million BBC Travel fans/i);
});

test("cleanup: bbcfeatures raw cleanup keeps ordinary prose with social platforms and dashes", () => {
  const html =
    "<article>" +
    "<p>BBC editors reported how Facebook groups became gathering places for film fans during lockdown.</p>" +
    "<p>A real sentence can use --- as punctuation and must stay.</p>" +
    "<p>A real sentence can use -- as punctuation and must stay.</p>" +
    "</article>";
  const result = applyMergedProviderCleanup("bbcfeatures", "BBC Features", html);

  assert.match(result, /Facebook groups became gathering places/);
  assert.match(result, /use --- as punctuation/);
  assert.match(result, /use -- as punctuation/);
});

test("cleanup: smithsonian drops promo cover anchor but keeps real figure", () => {
  const cleanup = providerCleanup("smithsonian", "Smithsonian");
  const html =
    "<article>" +
    "<p>Smithsonian article text.</p>" +
    '<figure><img src="https://cdn.smithsonianmag.com/real-article-photo.jpg" alt="Real article photo"/><figcaption>Real article caption.</figcaption></figure>' +
    '<p><a href="https://subscribe.smithsonianmag.com/?inetz=article-banner-ad&promo_name=current-issue">' +
    '<img src="https://cdn.smithsonianmag.com/julaug2026_web_cover_1_720.jpg" alt="Cover image of the Smithsonian Magazine Summer 2026 issue"/>' +
    "</a></p>" +
    "</article>";
  const result = applyProviderCleanup(html, cleanup);
  assert.doesNotMatch(result, /julaug2026_web_cover_1_720\.jpg/);
  assert.doesNotMatch(result, /subscribe\.smithsonianmag\.com/);
  assert.doesNotMatch(result, /promo_name/);
  assert.doesNotMatch(result, /<p>\s*<\/p>/);
  assert.match(result, /real-article-photo\.jpg/);
  assert.match(result, /Real article caption/);
});

test("cleanup: smithsonian drops affiliate-link note while preserving article prose", () => {
  const cleanup = providerCleanup("smithsonian", "Smithsonian");
  const html =
    "<article>" +
    "<p>Real Smithsonian article prose about conservation and field research.</p>" +
    "<p>A Note to our Readers Smithsonian magazine participates in affiliate link advertising programs. If you purchase an item through these links, we receive a commission.</p>" +
    "<p>The final paragraph continues the reported article without promotional copy.</p>" +
    "</article>";
  const result = applyProviderCleanup(html, cleanup);
  assert.doesNotMatch(result, /affiliate link advertising programs/i);
  assert.doesNotMatch(result, /receive a commission/i);
  assert.match(result, /Real Smithsonian article prose/);
  assert.match(result, /final paragraph continues/);
});

test("cleanup: nautilus removes figcaptions while preserving image src values", () => {
  const html =
    "<article>" +
    "<p>Nautilus article text.</p>" +
    '<figure><img src="https://lede-admin.nautil.us/wp-content/uploads/sites/70/6600_136c2f0599b3a0175c544b72e4861b9f.jpg" alt="">' +
    '<figcaption><a href="http://www.shutterstock.com/pic-210090625/stock-photo-women-s-lips-closeup-photo-of-the-of-women-s-profiles.html" rel="noopener noreferrer nofollow" target="_blank">Shutterstock</a></figcaption></figure>' +
    '<figure><img src="https://lede-admin.nautil.us/wp-content/uploads/sites/70/real-article-photo.jpg" alt="Research team at work">' +
    "<figcaption>A research team prepares the experiment before dawn. Shutterstock</figcaption></figure>" +
    "</article>";
  const result = applyMergedProviderCleanup("nautilus", "Nautilus", html);
  assert.match(result, /6600_136c2f0599b3a0175c544b72e4861b9f\.jpg/);
  assert.doesNotMatch(result, /stock-photo-women-s-lips/i);
  assert.doesNotMatch(result, /<figcaption/i);
  assert.doesNotMatch(result, /Shutterstock/i);
  assert.match(result, /real-article-photo\.jpg/);
  assert.doesNotMatch(result, /research team prepares the experiment/i);
  const sanitized = sanitizeArticleHtml(result);
  assert.match(sanitized, /6600_136c2f0599b3a0175c544b72e4861b9f\.jpg/);
  assert.doesNotMatch(sanitized, /<figcaption/i);
  assert.doesNotMatch(sanitized, /Shutterstock/i);
});

test("cleanup: knowable removes credit figcaptions while preserving image src values", () => {
  const html =
    "<article>" +
    "<p>Knowable article text.</p>" +
    '<figure><img src="https://knowablemagazine.org/docserver/fulltext/ant-behavior.jpg" alt="Ant behavior">' +
    "<figcaption>CREDIT: ADAPTED FROM F. HALBOTH &amp; F. ROCES / PLOS ONE 2017</figcaption></figure>" +
    '<figure><img src="https://knowablemagazine.org/docserver/fulltext/wild-photo.jpg" alt="Wildlife closeup">' +
    "<figcaption>CREDIT: © ALEXANDER WILD; CREDIT: WOLFGANG THALER</figcaption></figure>" +
    "</article>";
  const result = applyMergedProviderCleanup("knowable", "Knowable", html);
  assert.match(result, /ant-behavior\.jpg/);
  assert.match(result, /wild-photo\.jpg/);
  assert.doesNotMatch(result, /<figcaption/i);
  assert.doesNotMatch(result, /HALBOTH/i);
  assert.doesNotMatch(result, /ALEXANDER WILD/i);
  assert.doesNotMatch(result, /WOLFGANG THALER/i);
});

test("cleanup: figcaptions remain unless a provider opts in to dropping them", () => {
  const html =
    "<article>" +
    '<figure><img src="https://example.com/default-provider-photo.jpg" alt="Article image">' +
    "<figcaption>A meaningful default-provider caption.</figcaption></figure>" +
    '<div class="newsletter">Subscribe for updates.</div>' +
    "</article>";
  const result = applyProviderCleanup(html, GENERIC_PROVIDER_CLEANUP);
  assert.match(result, /default-provider-photo\.jpg/);
  assert.match(result, /meaningful default-provider caption/i);
  assert.doesNotMatch(result, /Subscribe for updates/i);
});

test("cleanup: smithsonian drops repeated Hakai attribution while preserving prose", () => {
  const cleanup = providerCleanup("smithsonian", "Smithsonian");
  const html =
    "<article>" +
    "<p>Reported coastal science article prose continues here.</p>" +
    "<p>This article is from Hakai Magazine, an online publication about science and society in coastal ecosystems.</p>" +
    "<p>Another substantive paragraph remains available for readers.</p>" +
    "</article>";
  const result = applyProviderCleanup(html, cleanup);
  assert.doesNotMatch(result, /Hakai Magazine/i);
  assert.match(result, /Reported coastal science article prose/);
  assert.match(result, /substantive paragraph remains/);
});

test("cleanup: removes comment block matched by class keyword", () => {
  const html =
    "<p>Article.</p>" +
    '<section class="comments-section"><h2>Comments</h2><div>User comment text</div></section>' +
    "<p>Footer text.</p>";
  const result = applyProviderCleanup(html, { dropClassKeywords: ["comment"] });
  assert.doesNotMatch(result, /User comment text/);
  assert.doesNotMatch(result, /Comments/);
  assert.match(result, /Article/);
});

test("cleanup: keyword match is case-insensitive", () => {
  const html =
    '<div class="NEWSLETTER-SIGNUP"><p>Subscribe!</p></div>' +
    "<p>Real content.</p>";
  const result = applyProviderCleanup(html, { dropClassKeywords: ["newsletter"] });
  assert.doesNotMatch(result, /Subscribe!/);
  assert.match(result, /Real content/);
});

// ---------------------------------------------------------------------------
// Combined dropSelectors + dropClassKeywords
// ---------------------------------------------------------------------------

test("cleanup: main <p> paragraphs are preserved after combined cleanup", () => {
  const html =
    "<article>" +
    "<p>Paragraph one with important content.</p>" +
    '<aside><p>Aside boilerplate text</p></aside>' +
    "<p>Paragraph two continues the story.</p>" +
    '<div class="related-posts"><a href="/other">Read more stories</a></div>' +
    '<video src="promo.mp4"></video>' +
    "<p>Paragraph three concludes the article.</p>" +
    "</article>";
  const result = applyProviderCleanup(html, {
    dropSelectors: ["aside", "video"],
    dropClassKeywords: ["related"],
  });
  assert.match(result, /Paragraph one/);
  assert.match(result, /Paragraph two/);
  assert.match(result, /Paragraph three/);
  assert.doesNotMatch(result, /Aside boilerplate text/);
  assert.doesNotMatch(result, /Read more stories/);
  assert.doesNotMatch(result, /promo\.mp4/);
});

// ---------------------------------------------------------------------------
// Edge-case / safety guardrails
// ---------------------------------------------------------------------------

test("cleanup: no-op when cleanup config is empty", () => {
  const html = "<p>Content here — should be byte-for-byte unchanged.</p>";
  const result = applyProviderCleanup(html, {});
  assert.equal(result, html);
});

test("cleanup: no-op when both arrays are empty", () => {
  const html = "<p>Content unchanged.</p>";
  const result = applyProviderCleanup(html, { dropSelectors: [], dropClassKeywords: [] });
  assert.equal(result, html);
});

test("cleanup: ignores selector-syntax entries in dropSelectors (only plain tag names accepted)", () => {
  // ".ad" and "#promo" are not plain tag names; they should be silently filtered
  const html = '<div class="ad">Ad block</div><p>Real content</p>';
  const result = applyProviderCleanup(html, { dropSelectors: [".ad", "#promo"] });
  // The div.ad should NOT be removed — only plain tag names work here
  assert.match(result, /Ad block/, "complex selectors must be rejected");
  assert.match(result, /Real content/);
});

test("cleanup: only block container tags are checked for keyword matching (not inline tags)", () => {
  // A <span> with class "related" inside a paragraph should NOT be removed
  const html = '<p>Text with a <span class="related-label">related</span> inline tag.</p>';
  const result = applyProviderCleanup(html, { dropClassKeywords: ["related"] });
  // The <span> is an inline element — should not be stripped
  assert.match(result, /Text with a/, "paragraph text should be preserved");
  assert.match(result, /inline tag/, "inline text should be preserved");
});

test("cleanup: does NOT remove <script type='application/ld+json'> (JSON-LD preserved)", () => {
  // Cleanup must leave <script> elements intact so JSON-LD can be extracted afterwards
  const html =
    '<script type="application/ld+json">{"@type":"NewsArticle","headline":"Test"}</script>' +
    '<div class="newsletter"><p>Subscribe!</p></div>' +
    "<p>Article paragraph.</p>";
  const result = applyProviderCleanup(html, { dropClassKeywords: ["newsletter"] });
  assert.match(result, /NewsArticle/, "JSON-LD script content must survive cleanup");
  assert.doesNotMatch(result, /Subscribe!/);
  assert.match(result, /Article paragraph/);
});
