import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decodeEntities,
  stripTags,
  metaContent,
  extractArticleJsonLd,
  extractArticle,
} from "@/lib/scraper/extract";

test("decodeEntities handles named and numeric entities", () => {
  assert.equal(decodeEntities("a &amp; b &lt;c&gt; &#39;x&#39;"), "a & b <c> 'x'");
  assert.equal(decodeEntities("&#x27;quote&#x27;"), "'quote'");
});

test("stripTags removes markup and collapses whitespace", () => {
  assert.equal(stripTags("<p>Hello   <b>world</b></p>"), "Hello world");
});

test("metaContent reads property/name meta tags in either attribute order", () => {
  const html =
    '<meta property="og:title" content="My Title">' +
    '<meta content="Jane" name="author">';
  assert.equal(metaContent(html, "og:title"), "My Title");
  assert.equal(metaContent(html, "author"), "Jane");
  assert.equal(metaContent(html, "missing"), null);
});

test("extractArticleJsonLd finds the NewsArticle node within @graph", () => {
  const ld = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "WebPage" },
      { "@type": "NewsArticle", headline: "Big News" },
    ],
  };
  const html = `<script type="application/ld+json">${JSON.stringify(ld)}</script>`;
  const node = extractArticleJsonLd(html);
  assert.ok(node);
  assert.equal(node?.headline, "Big News");
});

function buildBody(words: number): string {
  return "<p>" + Array.from({ length: words }, () => "word").join(" ") + "</p>";
}

test("extractArticle parses JSON-LD article into a cleaned record", () => {
  const ld = {
    "@type": "NewsArticle",
    headline: "Climate Update",
    author: { name: "Sam Reporter" },
    articleBody: Array.from({ length: 80 }, () => "rain").join(" "),
    datePublished: "2026-01-02T10:00:00Z",
    description: "A short summary.",
  };
  const html =
    `<html><head><title>Fallback</title>` +
    `<script type="application/ld+json">${JSON.stringify(ld)}</script>` +
    `</head><body></body></html>`;
  const result = extractArticle(html, "https://www.nbcnews.com/science/story");
  assert.ok(result);
  assert.equal(result?.title, "Climate Update");
  assert.equal(result?.author, "Sam Reporter");
  assert.ok((result?.wordCount ?? 0) >= 50);
  assert.match(result?.content ?? "", /rain/);
  assert.equal(result?.publishedAt?.toISOString(), "2026-01-02T10:00:00.000Z");
});

test("extractArticle rejects bodies under 50 words", () => {
  const html =
    "<html><head><title>Tiny</title></head><body><article>" +
    buildBody(5) +
    "</article></body></html>";
  assert.equal(extractArticle(html, "https://www.nbcnews.com/x"), null);
});

test("extractArticle returns null without a title", () => {
  const html = "<html><body><article>" + buildBody(80) + "</article></body></html>";
  assert.equal(extractArticle(html, "https://www.nbcnews.com/x"), null);
});

test("extractArticle returns null for an invalid URL", () => {
  const html = "<html><head><title>T</title></head><body></body></html>";
  assert.equal(extractArticle(html, "not a url"), null);
});

test("extractArticle sanitizes scraped body HTML (strips script/onerror/javascript:)", () => {
  const filler = Array.from({ length: 60 }, () => "word").join(" ");
  const html =
    "<html><head><title>Malicious Page</title></head><body><article>" +
    `<p>Intro ${filler}<script>window.__pwned=1;alert('xss')</script> trailing.</p>` +
    `<p><img src="x" onerror="alert('xss')"> ` +
    `<a href="javascript:alert('xss')">click</a> ${filler}</p>` +
    "</article></body></html>";
  const result = extractArticle(html, "https://www.nbcnews.com/security/story");
  assert.ok(result, "article should still extract");
  const content = result?.content ?? "";
  // Sanitizer must remove the dangerous constructs entirely.
  assert.doesNotMatch(content, /<script/i, "no <script> tags");
  assert.doesNotMatch(content, /onerror/i, "no inline event handlers");
  assert.doesNotMatch(content, /javascript:/i, "no javascript: scheme");
  // ...while preserving legitimate prose.
  assert.match(content, /word/);
});

test("extractArticle sanitizes a malicious JSON-LD headline path's body", () => {
  const ld = {
    "@type": "NewsArticle",
    headline: "Breaking <img src=x onerror=alert(1)> News",
    articleBody: Array.from({ length: 80 }, () => "ocean").join(" "),
    datePublished: "2026-02-03T08:00:00Z",
  };
  const html =
    "<html><head><title>Fallback</title>" +
    `<script type="application/ld+json">${JSON.stringify(ld)}</script>` +
    "</head><body></body></html>";
  const result = extractArticle(html, "https://www.nbcnews.com/world/story");
  assert.ok(result);
  // Body comes from articleBody (plain text) -> no markup leaks into content.
  assert.doesNotMatch(result?.content ?? "", /onerror/i);
  assert.doesNotMatch(result?.content ?? "", /<img/i);
  assert.match(result?.content ?? "", /ocean/);
});

// ---------------------------------------------------------------------------
// Clean-capture pipeline: Readability + declutter (#838–#840 integration)
// ---------------------------------------------------------------------------

/** Builds a unique-word block so assertions can target the real body. */
function wordBlock(n: number, seed: string): string {
  return Array.from({ length: n }, (_, i) => `${seed}${i + 1}`).join(" ");
}

test("extractArticle (clean capture): removes the trailing author-bio paragraph but keeps the body", () => {
  // Full page, no JSON-LD -> the raw-<p> / Readability path. The article ends
  // with a "By Jane Doe. Jane is a senior writer at …" bio paragraph that the
  // declutter pass must strip while the real prose is preserved end-to-end.
  const html =
    "<html><head><title>The Future of Cities</title>" +
    '<meta name="author" content="Jane Doe">' +
    "</head><body><article>" +
    `<p>Cities are changing. ${wordBlock(40, "urban")} and more.</p>` +
    `<p>The shift continues. ${wordBlock(40, "transit")} every day.</p>` +
    "<p>By Jane Doe. Jane is a senior writer at Example Magazine covering urban affairs.</p>" +
    "</article></body></html>";

  const result = extractArticle(html, "https://unknown-news.example.com/article/future-cities");
  assert.ok(result, "should extract a valid article");
  assert.equal(result?.title, "The Future of Cities");
  // Real article body survives.
  assert.match(result?.content ?? "", /urban\d+/, "first body paragraph must be kept");
  assert.match(result?.content ?? "", /transit\d+/, "second body paragraph must be kept");
  // The trailing author byline/bio (the user's core complaint) is GONE.
  assert.doesNotMatch(
    result?.content ?? "",
    /senior writer at Example Magazine/,
    "author bio sentence must be removed",
  );
  assert.doesNotMatch(result?.content ?? "", /By Jane Doe/, "trailing byline must be removed");
  // Author metadata is still captured.
  assert.equal(result?.author, "Jane Doe");
});

test("extractArticle (clean capture): SCRAPER_READABILITY=false still yields a valid article via the legacy + declutter path", () => {
  const prev = process.env.SCRAPER_READABILITY;
  process.env.SCRAPER_READABILITY = "false";
  try {
    const html =
      "<html><head><title>Legacy Path Article</title>" +
      '<meta name="author" content="Jane Doe">' +
      "</head><body><article>" +
      `<p>Cities are changing. ${wordBlock(40, "legacy")} and more.</p>` +
      `<p>The shift continues. ${wordBlock(40, "fallback")} every day.</p>` +
      "<p>By Jane Doe. Jane is a senior writer at Example Magazine covering urban affairs.</p>" +
      "</article></body></html>";

    const result = extractArticle(html, "https://unknown-news.example.com/article/legacy");
    assert.ok(result, "legacy path should still extract a valid article");
    // Full body preserved by the legacy <p>-harvest.
    assert.match(result?.content ?? "", /legacy\d+/);
    assert.match(result?.content ?? "", /fallback\d+/);
    // Declutter runs in the legacy path too, so the bio is still stripped.
    assert.doesNotMatch(result?.content ?? "", /senior writer at Example Magazine/);
    assert.doesNotMatch(result?.content ?? "", /By Jane Doe/);
  } finally {
    if (prev === undefined) delete process.env.SCRAPER_READABILITY;
    else process.env.SCRAPER_READABILITY = prev;
  }
});

test("extractArticle (clean capture): a long multi-paragraph article loses no body content", () => {
  // Guards the never-lose-content property: every paragraph of a normal raw
  // article must survive the Readability + declutter pipeline.
  const paragraphs = Array.from(
    { length: 6 },
    (_, i) => `<p>${wordBlock(25, `block${i}`)} sentence here.</p>`,
  );
  const html =
    "<html><head><title>Long Article</title></head><body><article>" +
    paragraphs.join("") +
    "</article></body></html>";

  const result = extractArticle(html, "https://unknown-news.example.com/article/long");
  assert.ok(result, "should extract the article");
  for (let i = 0; i < 6; i++) {
    assert.match(
      result?.content ?? "",
      new RegExp(`block${i}\\d+`),
      `paragraph ${i} must be preserved (no body loss)`,
    );
  }
});

test("extractArticle (clean capture, e2e): class-less bio + newsletter CTA removed, body kept", () => {
  // Realistic page, NO JSON-LD -> Readability path strips class/id, so the
  // declutter pass must catch the class-less author bio + newsletter CTA by
  // TEXT, while related/share blocks (still class-bearing pre-Readability) and
  // the body prose are handled correctly end-to-end.
  const html =
    `<!doctype html><html><head><title>Why Cities Are Rethinking Transit</title>` +
    `<meta property="og:title" content="Why Cities Are Rethinking Transit"><meta name="author" content="Jane Doe"></head><body>` +
    `<nav>Home World Politics</nav>` +
    `<article><h1>Why Cities Are Rethinking Transit</h1>` +
    `<p>Across the world, cities are reconsidering how people move through dense urban cores, weighing buses, bikes, and trains against the stubborn dominance of the private car.</p>` +
    `<p>Planners argue that the next decade of investment will determine whether downtowns become more livable or simply more congested, and the choices are political as much as technical.</p>` +
    `<p>New pilot programs in several metro areas suggest that small, well-targeted changes to street design can shift commuter behavior faster than expensive megaprojects.</p>` +
    `<div class="social-share">Share: <a href="#">Twitter</a> <a href="#">Facebook</a></div>` +
    `<aside class="related"><h3>Related</h3><ul><li><a href="/a">The bus revival</a></li><li><a href="/b">Bike lanes that work</a></li></ul></aside>` +
    `<p class="author-bio">By Jane Doe. Jane is a senior transportation writer at DailyExample covering cities and mobility. Follow her @janedoe.</p>` +
    `<div class="newsletter">Subscribe to our weekly newsletter for more stories like this.</div>` +
    `</article><footer>© 2026 DailyExample.</footer></body></html>`;

  const result = extractArticle(html, "https://dailyexample.example.com/transit/rethinking");
  assert.ok(result, "should extract a valid article");
  const content = result?.content ?? "";

  // Body prose survives.
  assert.match(content, /stubborn dominance of the private car/, "body sentence kept");
  // Author bio (the user's complaint) is gone.
  assert.doesNotMatch(content, /senior transportation writer/, "author bio removed");
  // Newsletter CTA is gone.
  assert.doesNotMatch(content, /weekly newsletter/, "newsletter CTA removed");
  // Related + share are absent.
  assert.doesNotMatch(content, /The bus revival/, "related links removed");
  assert.doesNotMatch(content, /Share on|Share:/, "share block removed");
  // Author metadata still captured.
  assert.equal(result?.author, "Jane Doe");
});

test("extractArticle (generic provider cleanup): strips chrome while preserving images and video links", () => {
  const prev = process.env.SCRAPER_READABILITY;
  process.env.SCRAPER_READABILITY = "false";
  try {
    const html =
      `<!doctype html><html><head><title>A Study of Urban Wildlife</title>` +
      `<meta property="og:title" content="A Study of Urban Wildlife"></head><body>` +
      `<article>` +
      `<p>${wordBlock(35, "wildlife")} article body before image.</p>` +
      `<figure><img src="/photos/fox.jpg" alt="Urban fox"><figcaption>A fox crosses a city street.</figcaption></figure>` +
      `<p>${wordBlock(35, "habitat")} Watch the companion <a href="https://time.com/video/urban-wildlife/">video interview</a> with the researchers.</p>` +
      `<div data-testid="recirc-related"><h2>More like this</h2><ul><li><a href="/1111111/noisy/">Noisy related story</a></li></ul></div>` +
      `<div aria-label="share this article"><a href="#">Share on X</a></div>` +
      `<div class="newsletter-signup">Get the latest stories in your inbox.</div>` +
      `</article></body></html>`;

    const result = extractArticle(html, "https://time.com/1234567/urban-wildlife/");
    assert.ok(result, "should extract a valid article");
    const content = result?.content ?? "";

    assert.match(content, /wildlife\d+/, "article body kept");
    assert.match(content, /<img src="https:\/\/time\.com\/photos\/fox\.jpg"/, "article image kept");
    assert.match(content, /video interview/, "article-related video link text kept");
    assert.match(content, /https:\/\/time\.com\/video\/urban-wildlife\//, "video link href kept");
    assert.doesNotMatch(content, /Noisy related story/, "related chrome removed");
    assert.doesNotMatch(content, /Share on X/, "share chrome removed");
    assert.doesNotMatch(content, /latest stories in your inbox/, "newsletter chrome removed");
  } finally {
    if (prev === undefined) delete process.env.SCRAPER_READABILITY;
    else process.env.SCRAPER_READABILITY = prev;
  }
});
