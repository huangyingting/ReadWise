process.env.LOG_LEVEL = "error";

import { afterEach, test } from "node:test";
import assert from "node:assert/strict";

const previousReadability = process.env.SCRAPER_READABILITY;

afterEach(() => {
  if (previousReadability === undefined) {
    delete process.env.SCRAPER_READABILITY;
  } else {
    process.env.SCRAPER_READABILITY = previousReadability;
  }
});

function words(count: number, prefix = "word"): string {
  return Array.from({ length: count }, (_, index) => `${prefix}${index}`).join(" ");
}

test("extractArticle handles invalid inputs and nested JSON-LD metadata variants", async () => {
  const { extractArticle, extractArticleJsonLd } = await import("@/lib/scraper/extract");
  assert.equal(extractArticle("<p>No title</p>", "not a url"), null);
  assert.equal(
    extractArticleJsonLd('<script type="application/ld+json">{bad json</script>'),
    null,
  );

  const html = `
    <script type="application/ld+json">
      {
        "@graph": [
          { "@type": "Thing", "name": "Ignored" },
          {
            "@type": ["Thing", "NewsArticle"],
            "headline": "JSON-LD &amp; Story",
            "author": ["Alice", { "name": " Bob " }, { "name": "" }],
            "image": [{}, { "url": "/hero.jpg" }],
            "datePublished": "not a date",
            "articleSection": "science",
            "description": "Structured description",
            "articleBody": "${words(65, "structured")}"
          }
        ]
      }
    </script>
  `;

  const article = extractArticle(html, "https://example.com/story");

  assert.equal(article?.title, "JSON-LD & Story");
  assert.equal(article?.author, "Alice, Bob");
  assert.equal(article?.heroImage, "https://example.com/hero.jpg");
  assert.equal(article?.publishedAt, null);
  assert.equal(article?.excerpt, "Structured description");
});

test("extractArticle tolerates unsupported JSON-LD author and image shapes", async () => {
  const { extractArticle } = await import("@/lib/scraper/extract");
  const html = `
    <script type="application/ld+json">
      {
        "@type": "Article",
        "headline": "Odd Metadata",
        "author": 42,
        "image": [{ "url": "" }, { "url": 123 }],
        "articleBody": "${words(60, "odd")}"
      }
    </script>
  `;

  const article = extractArticle(html, "https://example.com/odd");

  assert.ok(article);
  assert.equal(article.author, null);
  assert.equal(article.heroImage, null);
});

test("extractArticle harvests DOM media, captions, and supported video links without readability", async () => {
  process.env.SCRAPER_READABILITY = "false";
  const { extractArticle } = await import("@/lib/scraper/extract");
  const prose = words(70, "harvest");
  const html = `
    <html>
      <head>
        <title>DOM Harvest</title>
        <meta property="og:image" content="http://[::1">
        <meta name="author" content="Reporter">
      </head>
      <body>
        <nav><p>Navigation should stay out.</p></nav>
        <article>
          <h2>Section heading</h2>
          <p>${prose}</p>
          <figure>
            <img src="data:image/gif;base64,placeholder" data-src="/images/photo.jpg" alt="Photo">
            <figcaption>Useful caption</figcaption>
          </figure>
          <figure><iframe src="https://player.vimeo.com/video/123"></iframe></figure>
          <img src="/images/standalone.jpg" alt="Standalone">
          <img src="/assets/logo.svg" alt="logo">
          <iframe src="https://www.youtube.com/embed/demo"></iframe>
          <iframe src="https://player.example.com/embed"></iframe>
          <a href="https://youtu.be/demo">Watch clip</a>
          <figcaption>Standalone caption</figcaption>
          <p>   </p>
        </article>
      </body>
    </html>
  `;

  const article = extractArticle(html, "https://example.com/story");

  assert.ok(article);
  assert.match(article.content, /https:\/\/example\.com\/images\/photo\.jpg/);
  assert.match(article.content, /https:\/\/example\.com\/images\/standalone\.jpg/);
  assert.match(article.content, /Watch video|Watch clip/);
  assert.doesNotMatch(article.content, /logo\.svg/);
  assert.equal(article.author, "Reporter");
});

test("extractArticle falls back to the largest prose container when semantic wrappers are absent", async () => {
  process.env.SCRAPER_READABILITY = "false";
  const { extractArticle } = await import("@/lib/scraper/extract");
  const html = `
    <html>
      <head><title>Largest Container</title></head>
      <body>
        <section class="chrome"><p>Short sidebar text.</p></section>
        <div class="story">
          <p>${words(60, "container")}</p>
          <blockquote>Quoted context that belongs to the article.</blockquote>
        </div>
      </body>
    </html>
  `;

  const article = extractArticle(html, "https://unknown.example/path");

  assert.ok(article);
  assert.equal(article.source, "unknown.example");
  assert.match(article.content, /Quoted context/);
  assert.doesNotMatch(article.content, /Short sidebar text/);
});

test("extractArticle can select media-only article scopes and body fallback when no dominant container exists", async () => {
  process.env.SCRAPER_READABILITY = "false";
  const { extractArticle } = await import("@/lib/scraper/extract");
  const mediaOnly = `
    <html><head><title>Media Only</title></head><body>
      <article><figure><img src="/photo.jpg" alt="Photo"></figure></article>
      <p>${words(55, "caption")}</p>
    </body></html>
  `;
  assert.equal(extractArticle(mediaOnly, "https://example.com/media"), null);

  const splitBody = `
    <html><head><title>Split Body</title></head><body>
      <div><p>${words(35, "left")}</p></div>
      <div><p>${words(35, "right")}</p></div>
    </body></html>
  `;
  const article = extractArticle(splitBody, "https://example.com/split");
  assert.ok(article);
  assert.match(article.content, /left0/);
  assert.match(article.content, /right0/);
});
