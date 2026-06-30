import { sanitizeArticleHtml } from "@/lib/sanitize";
import { isValidCategorySlug } from "@/lib/categories";
import type { Provider, ScrapedArticle } from "@/lib/scraper/types";
import { mapSectionToCategory, providerForUrl } from "@/lib/scraper/providers";
import {
  GENERIC_PROVIDER_CLEANUP,
  applyProviderCleanup,
  mergeProviderCleanup,
} from "@/lib/scraper/cleanup";
import { normalizeArticleHtml, stripScriptsAndStyles } from "@/lib/scraper/normalize";
import { extractReadable } from "@/lib/scraper/readability-extract";
import { declutterArticleHtml } from "@/lib/scraper/declutter";
import { scraperReadability } from "@/lib/runtime-config/scraper";
import { parseHTML } from "linkedom";

const WORDS_PER_MINUTE = 200;

/**
 * Maximum ratio of legacy-body words to Readability-body words before we treat
 * Readability as having over-trimmed and keep the longer legacy body instead.
 *
 * Readability normally wins (it isolates the real article and strips chrome the
 * `<p>`-harvest leaves behind). But when the legacy harvest is more than 1.5×
 * longer than Readability's output, that gap signals Readability dropped real
 * prose — so we fall back to legacy to guarantee no article body is lost.
 */
const READABILITY_LEGACY_MAX_WORD_RATIO = 1.5;

/**
 * Minimum ratio of Readability-body words to JSON-LD-body words required before
 * we prefer the Readability body over a JSON-LD `articleBody` to recover inline
 * images.
 *
 * A JSON-LD `articleBody` is plain text, so wrapping it in `<p>` yields zero
 * images. When Readability captured essentially the same article *with* its
 * inline image(s) over a comparable-length body, we switch to Readability so the
 * imagery is not lost (e.g. NBC News, whose JSON-LD body is image-less). This
 * floor guards the swap: it never trades a full canonical JSON-LD body for a
 * short Readability stub on providers where JSON-LD is canonical precisely
 * *because* Readability under-performs.
 */
const READABILITY_LD_MIN_WORD_RATIO = 0.6;

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  "#39": "'",
  "#x27": "'",
  "#34": '"',
};

export function decodeEntities(input: string): string {
  return input
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&([a-z0-9#]+);/gi, (m, name) => ENTITIES[name] ?? ENTITIES[name.toLowerCase()] ?? m);
}

export function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function countWords(text: string): number {
  const matches = text.match(/\S+/g);
  return matches ? matches.length : 0;
}

/** Counts `<img>` tags in an HTML fragment — a content-image presence probe. */
function countImages(html: string): number {
  const matches = html.match(/<img\b/gi);
  return matches ? matches.length : 0;
}

/** Reads the `content` of a `<meta>` tag matched by property/name = key. */
export function metaContent(html: string, key: string): string | null {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(
      `<meta[^>]+(?:property|name|itemprop)=["']${escaped}["'][^>]*\\scontent=["']([^"']*)["']`,
      "i",
    ),
    new RegExp(
      `<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name|itemprop)=["']${escaped}["']`,
      "i",
    ),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m && m[1]) return decodeEntities(m[1]).trim();
  }
  return null;
}

type JsonLdRecord = Record<string, unknown>;

/** Extracts and flattens all JSON-LD blocks, returning the first article node. */
export function extractArticleJsonLd(html: string): JsonLdRecord | null {
  const blocks = html.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  );
  const nodes: JsonLdRecord[] = [];
  for (const block of blocks) {
    const raw = block[1]?.trim();
    if (!raw) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    collectNodes(parsed, nodes);
  }
  const articleTypes = ["NewsArticle", "Article", "Report", "BlogPosting", "ReportageNewsArticle"];
  return (
    nodes.find((node) => {
      const t = node["@type"];
      const types = Array.isArray(t) ? t.map(String) : [String(t)];
      return types.some((type) => articleTypes.includes(type));
    }) ?? null
  );
}

function collectNodes(value: unknown, out: JsonLdRecord[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectNodes(item, out);
    return;
  }
  if (value && typeof value === "object") {
    const record = value as JsonLdRecord;
    out.push(record);
    if (Array.isArray(record["@graph"])) {
      collectNodes(record["@graph"], out);
    }
  }
}

function jsonLdString(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  return null;
}

function jsonLdAuthor(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") return value.trim() || null;
  if (Array.isArray(value)) {
    const names = value.map((v) => jsonLdAuthor(v)).filter((v): v is string => Boolean(v));
    return names.length ? names.join(", ") : null;
  }
  if (typeof value === "object") {
    const name = (value as JsonLdRecord).name;
    return typeof name === "string" ? name.trim() || null : null;
  }
  return null;
}

function jsonLdImage(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") return value.trim() || null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const url = jsonLdImage(item);
      if (url) return url;
    }
    return null;
  }
  if (typeof value === "object") {
    const url = (value as JsonLdRecord).url;
    return typeof url === "string" ? url.trim() || null : null;
  }
  return null;
}

function toAbsolute(url: string | null, base: string): string | null {
  if (!url) return null;
  try {
    return new URL(url, base).href;
  } catch {
    return null;
  }
}

/** Builds article HTML from a plain-text body by wrapping paragraphs in <p>. */
function paragraphsToHtml(text: string): string {
  return text
    .split(/\n{2,}|\r\n\r\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${p.replace(/\n/g, " ")}</p>`)
    .join("\n");
}

/**
 * Content-bearing elements the legacy harvest preserves, walked in document
 * order. Unlike the old `<p>`-only regex harvest this keeps headings, lists,
 * quotes and — crucially — `<figure>`/`<img>` so article imagery is no longer
 * dropped on the providers where Readability under-performs and legacy wins.
 */
const HARVEST_SELECTOR = "p,h2,h3,h4,h5,h6,ul,ol,blockquote,figure,figcaption,img,iframe,a";

/**
 * Resolved-`src` fragments that mark site chrome (logos, sprites, tracking
 * pixels, lazy-load placeholders, icon/badge SVGs) rather than real article
 * imagery. Matched with word-ish boundaries so a real photo whose path merely
 * contains a keyword as a substring (e.g. `/silicon-valley/…` → "icon") is not
 * dropped. Deliberately conservative: when an image is not clearly chrome it is
 * kept (the downstream `sanitizeArticleHtml` allowlist is the safety net).
 */
const CHROME_IMG_RE =
  /(?:^|[/_.\-])(?:logo|sprite|icon|avatar|placeholder|pixel|1x1|blank|spacer|tracking|button|badge)(?:[/_.\-]|$)|\.svg(?:$|\?)/i;

/** True when a resolved absolute image URL looks like site chrome, not content. */
function isChromeImage(absSrc: string): boolean {
  if (!absSrc) return true;
  if (/^data:/i.test(absSrc)) return true;
  return CHROME_IMG_RE.test(absSrc);
}

/** A `src` value that is a lazy-load stand-in rather than the real image. */
function isLazyPlaceholderSrc(src: string): boolean {
  return src.length === 0 || /^data:|placeholder|blank|1x1|spacer|loading/i.test(src);
}

function isSupportedVideoUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    return (
      host === "youtube.com" ||
      host === "youtu.be" ||
      host.endsWith(".youtube.com") ||
      host === "vimeo.com" ||
      host.endsWith(".vimeo.com")
    );
  } catch {
    return false;
  }
}

function videoLinkHtml(url: string): string {
  return `<a href="${url}">Watch video</a>`;
}

type DomElement = NonNullable<ReturnType<typeof parseHTML>["document"]["body"]> | null;

/** Has at least one harvestable text block or a content image. */
function hasHarvestableContent(el: DomElement): boolean {
  if (!el) return false;
  for (const block of Array.from(el.querySelectorAll("p,h2,h3,h4,h5,h6,li,blockquote"))) {
    if ((block.textContent ?? "").trim().length > 0) return true;
  }
  return el.querySelector("img,figure") !== null;
}

/** Combined text length of all `<p>` descendants — a cheap "prose mass" proxy. */
function paragraphTextLen(el: DomElement): number {
  if (!el) return 0;
  let total = 0;
  for (const p of Array.from(el.querySelectorAll("p"))) {
    total += (p.textContent ?? "").trim().length;
  }
  return total;
}

/**
 * Find the smallest container that still holds essentially all of the page's
 * prose, so sibling chrome (nav/footer/rails) around it is excluded. Only
 * returned when one container captures ≥90% of the body's paragraph text; this
 * keeps the harvest conservative — when prose is spread across the body we fall
 * back to `<body>` (the previous whole-page behavior).
 */
function largestContentContainer(document: ReturnType<typeof parseHTML>["document"]): DomElement {
  const body = document.body;
  if (!body) return null;
  const totalP = paragraphTextLen(body);
  if (totalP === 0) return null;
  let best: DomElement = null;
  let bestLen = 0;
  for (const el of Array.from(body.querySelectorAll("div,section,article,main"))) {
    const len = paragraphTextLen(el as DomElement);
    if (len > bestLen) {
      bestLen = len;
      best = el as DomElement;
    }
  }
  if (best && best !== body && bestLen >= totalP * 0.9) return best;
  return null;
}

/**
 * Choose the harvest scope: prefer a semantic `<article>`, then `<main>`, then
 * the largest plausible content container, then `<body>`. Falls back to the
 * document element so a fragment without `<body>` still harvests.
 */
function selectScope(document: ReturnType<typeof parseHTML>["document"]): DomElement {
  const article = document.querySelector("article") as DomElement;
  if (article && hasHarvestableContent(article)) return article;
  const main = document.querySelector("main") as DomElement;
  if (main && hasHarvestableContent(main)) return main;
  const largest = largestContentContainer(document);
  if (largest) return largest;
  return document.body ?? (document.documentElement as DomElement);
}

/**
 * Walks `scope` in document order and serializes content-bearing elements,
 * skipping any element already contained in one we took (so an `<img>` inside a
 * captured `<figure>`/`<p>` is not duplicated). Images are filtered (chrome
 * dropped) and their `src` resolved to absolute up front, so figures/paragraphs
 * serialize with usable URLs and `sanitizeArticleHtml` keeps them.
 */
function harvestContent(scope: NonNullable<DomElement>, baseUrl: string): string {
  // Pass 1: normalize images — absolutize real ones, drop chrome/placeholders.
  for (const img of Array.from(scope.querySelectorAll("img"))) {
    let raw = (img.getAttribute("src") ?? "").trim();
    const lazy = (
      img.getAttribute("data-src") ??
      img.getAttribute("data-original") ??
      img.getAttribute("data-lazy-src") ??
      ""
    ).trim();
    if (isLazyPlaceholderSrc(raw) && lazy) raw = lazy;
    const abs = toAbsolute(raw, baseUrl);
    if (!abs || isChromeImage(abs)) {
      img.remove();
      continue;
    }
    img.setAttribute("src", abs);
  }

  // Preserve supported article video embeds as ordinary links that survive the
  // sanitizer; unsupported iframes are left for sanitization to drop.
  for (const iframe of Array.from(scope.querySelectorAll("iframe"))) {
    const src = toAbsolute((iframe.getAttribute("src") ?? "").trim(), baseUrl);
    if (!src || !isSupportedVideoUrl(src)) continue;
    const { document } = parseHTML(videoLinkHtml(src));
    const link = document.querySelector("a");
    if (!link) continue;
    if (iframe.parentElement?.tagName.toLowerCase() === "figure") {
      iframe.replaceWith(link);
    } else {
      const wrapper = parseHTML(`<figure>${videoLinkHtml(src)}</figure>`).document.querySelector("figure");
      if (wrapper) iframe.replaceWith(wrapper);
    }
  }

  // Pass 2: collect top-level content elements in document order.
  const taken: Element[] = [];
  const parts: string[] = [];
  for (const el of Array.from(scope.querySelectorAll(HARVEST_SELECTOR))) {
    if (taken.some((t) => t.contains(el))) continue;
    const tag = el.tagName.toLowerCase();

    if (tag === "img") {
      // A content image not already inside a captured <figure>/<p>.
      taken.push(el);
      parts.push(`<figure>${el.outerHTML}</figure>`);
      continue;
    }
    if (tag === "iframe") {
      const src = toAbsolute((el.getAttribute("src") ?? "").trim(), baseUrl);
      if (!src || !isSupportedVideoUrl(src)) continue;
      taken.push(el);
      parts.push(`<figure>${videoLinkHtml(src)}</figure>`);
      continue;
    }
    if (tag === "a") {
      const href = toAbsolute((el.getAttribute("href") ?? "").trim(), baseUrl);
      if (!href || !isSupportedVideoUrl(href)) continue;
      taken.push(el);
      parts.push(`<figure><a href="${href}">${el.textContent?.trim() || "Watch video"}</a></figure>`);
      continue;
    }
    if (tag === "figcaption") {
      const text = (el.textContent ?? "").trim();
      if (text.length === 0) continue;
      taken.push(el);
      parts.push(`<p>${el.innerHTML}</p>`);
      continue;
    }

    const hasText = stripTags(el.innerHTML).length > 0;
    const hasMedia = el.querySelector("img,figure") !== null;
    if (!hasText && !hasMedia) continue; // preserve the "drop empty <p>" behavior
    taken.push(el);
    parts.push(el.outerHTML);
  }
  return parts.join("\n");
}

/** Legacy regex `<p>` harvest — the pre-DOM fallback (parse failure / no DOM). */
function legacyParagraphHarvest(html: string): string {
  const articleMatch = html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i);
  const scope = articleMatch ? articleMatch[1] : html;
  const paragraphs = [...scope.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((m) => m[1].trim())
    .filter((p) => stripTags(p).length > 0);
  if (paragraphs.length === 0) return "";
  return paragraphs.map((p) => `<p>${p}</p>`).join("\n");
}

/**
 * Extracts the raw body HTML from the page when JSON-LD has no articleBody.
 *
 * DOM-based (linkedom) so it walks real nodes: this both preserves article
 * imagery (`<figure>`/`<img>`, with `src` absolutized) and avoids the old
 * regex's false positives — e.g. literal `<p>…</p>` text living inside an
 * editor `<option value>` or an HTML comment is no longer harvested as prose.
 * Falls back to the legacy `<p>` regex harvest if parsing yields nothing.
 */
function extractBodyHtml(html: string, baseUrl: string): string {
  if (typeof html !== "string" || html.trim().length === 0) return "";
  let document: ReturnType<typeof parseHTML>["document"];
  try {
    ({ document } = parseHTML(html));
  } catch {
    return legacyParagraphHarvest(html);
  }
  const scope = selectScope(document);
  if (!scope) return legacyParagraphHarvest(html);
  const harvested = harvestContent(scope, baseUrl);
  return harvested.trim().length > 0 ? harvested : legacyParagraphHarvest(html);
}

function resolveCategory(provider: Provider | null, url: URL, section: string | null): string | null {
  const candidate =
    provider?.categoryFor?.(url, section) ??
    mapSectionToCategory(section) ??
    provider?.defaultCategory ??
    null;
  return candidate && isValidCategorySlug(candidate) ? candidate : null;
}

/**
 * Parses already-fetched HTML into a normalized, cleaned ScrapedArticle.
 * Combines schema.org JSON-LD, OpenGraph meta tags and raw `<p>` extraction so
 * it works across NBC News, National Geographic, Time and HuffPost.
 *
 * Pipeline:
 * 1. **Provider cleanup** (known providers only): removes noise blocks such as
 *    video players, newsletter CTAs, social-share widgets and ad containers
 *    before any extraction takes place. Unknown-provider fallback extraction
 *    skips this pass so legitimate article containers with generic class names
 *    are not discarded.
 * 2. **Metadata extraction**: JSON-LD, OpenGraph and `<meta>` tags are read
 *    from the cleaned HTML while `<script>` elements are still present.
 * 3. **Script/style stripping (UNCONDITIONAL)**: `<script>`, `<style>`,
 *    `<noscript>` and `<template>` elements are removed with their inner
 *    content from the HTML used for body extraction. This runs AFTER metadata
 *    extraction (so JSON-LD inside `<script type="application/ld+json">` is
 *    still read) and is NEVER gated, so inline analytics/JS text cannot leak
 *    into harvested paragraphs or the Readability body. Optional
 *    `SCRAPER_HTML_NORMALIZE` further trims inline attributes on top of this.
 * 4. **Body extraction (clean capture)**: a Readability pass
 *    (`extractReadable`, gated by `SCRAPER_READABILITY`, default ON) isolates
 *    the main article from the cleaned page HTML. The legacy body — JSON-LD
 *    `articleBody` when present, otherwise a DOM harvest of the main content
 *    (paragraphs, headings, lists, quotes and article imagery) — is computed as
 *    a fallback. JSON-LD `articleBody` (canonical structured text) is always
 *    kept; for the noisier harvest path Readability wins unless it appears to
 *    have over-trimmed (legacy >1.5× its words), guaranteeing no body is lost.
 * 5. **Declutter**: `declutterArticleHtml` strips residual boilerplate the
 *    extractor leaves behind — especially the trailing author byline/bio — in
 *    BOTH the Readability and legacy paths. Conservative (won't drop >35%).
 * 6. **Sanitization**: `sanitizeArticleHtml` is always the final pass — it
 *    enforces the strict tag/attr allowlist and is never bypassed.
 */
export function extractArticle(html: string, sourceUrl: string): ScrapedArticle | null {
  const provider = providerForUrl(sourceUrl);
  let urlObj: URL;
  try {
    urlObj = new URL(sourceUrl);
  } catch {
    return null;
  }

  // --- Step 1: provider-specific pre-extraction cleanup (known providers) ---
  // Removes video/iframe/newsletter/social/ad blocks BEFORE any extraction so
  // their text content doesn't leak into paragraphs or word counts. This is
  // intentionally limited to known providers; unknown fallback pages may use
  // generic words like "newsletter" on the real article/main container.
  const cleanedHtml = provider
    ? applyProviderCleanup(html, mergeProviderCleanup(GENERIC_PROVIDER_CLEANUP, provider.cleanup))
    : html;

  // --- Step 2: extract structured metadata (JSON-LD lives in <script> tags) -
  // We use `cleanedHtml` here — cleanup preserves <script> elements so that
  // JSON-LD is still intact at this point.
  const ld = extractArticleJsonLd(cleanedHtml);

  const title =
    (ld && (jsonLdString(ld.headline) ?? jsonLdString(ld.name))) ??
    metaContent(cleanedHtml, "og:title") ??
    (cleanedHtml.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
      ? decodeEntities(cleanedHtml.match(/<title[^>]*>([\s\S]*?)<\/title>/i)![1]).trim()
      : null);

  if (!title) return null;

  let author =
    (ld && jsonLdAuthor(ld.author)) ??
    metaContent(cleanedHtml, "author") ??
    metaContent(cleanedHtml, "article:author");

  const heroImage = toAbsolute(
    (ld && jsonLdImage(ld.image)) ?? metaContent(cleanedHtml, "og:image"),
    sourceUrl,
  );

  const section =
    (ld && jsonLdString(ld.articleSection)) ??
    metaContent(cleanedHtml, "article:section") ??
    metaContent(cleanedHtml, "og:article:section") ??
    metaContent(cleanedHtml, "parsely-section") ??
    metaContent(cleanedHtml, "news_keywords");

  const publishedRaw =
    (ld && jsonLdString(ld.datePublished)) ??
    metaContent(cleanedHtml, "article:published_time") ??
    metaContent(cleanedHtml, "datePublished");
  const publishedAt = publishedRaw ? safeDate(publishedRaw) : null;

  // --- Step 3: strip scripts/styles for body extraction (UNCONDITIONAL) ------
  // JSON-LD metadata was already read in step 2 (it lives inside
  // <script type="application/ld+json">), so it is now safe to remove ALL
  // <script>/<style>/<noscript>/<template> blocks with their inner content.
  // This runs ALWAYS (not gated by SCRAPER_HTML_NORMALIZE) so leftover inline
  // script/style text can never leak into harvested <p> paragraphs, the
  // Readability body, or a JSON-LD-less raw-<p> fallback.
  const scriptStrippedHtml = stripScriptsAndStyles(cleanedHtml);

  // Optional HTML normalization (disabled by default) further trims inline
  // event handlers / style attributes from the already script-stripped HTML.
  const { html: bodyHtml } = normalizeArticleHtml(scriptStrippedHtml);

  // --- Step 4: build the legacy body (JSON-LD articleBody or DOM harvest) ----
  // This is the fallback body and the canonical source when JSON-LD is present.
  const ldBody = ld && jsonLdString(ld.articleBody);
  const legacyBody = ldBody ? paragraphsToHtml(ldBody) : extractBodyHtml(bodyHtml, sourceUrl);

  // --- Step 5: clean-capture body via Readability (kill-switch, default ON) --
  // Readability isolates the main article from the script-stripped HTML so it
  // never scores or captures inline analytics/JS text.
  const readable = scraperReadability() ? extractReadable(scriptStrippedHtml, sourceUrl) : null;

  // Choose the body robustly so we never lose article content:
  //  - JSON-LD articleBody is canonical structured text → keep it by default,
  //    but recover inline images when it carries none (see the ld branch below).
  //  - For the noisier legacy DOM harvest, prefer Readability unless the legacy
  //    body is >1.5× longer (a sign Readability over-trimmed) or Readability
  //    produced nothing usable — then fall back to legacy.
  let chosenBody = legacyBody;
  if (readable && !ldBody) {
    const legacyWords = countWords(stripTags(legacyBody));
    const readableWords = readable.wordCount;
    const overTrimmed = legacyWords > readableWords * READABILITY_LEGACY_MAX_WORD_RATIO;
    if (!overTrimmed) {
      chosenBody = readable.contentHtml;
    }
  } else if (readable && ldBody) {
    // JSON-LD `articleBody` is plain text, so `legacyBody` (paragraphsToHtml)
    // has zero images. When the canonical prose carries no imagery but
    // Readability captured content image(s) over a comparable-length body,
    // prefer Readability so inline images are recovered instead of dropped
    // (e.g. NBC News serves an image-less JSON-LD body). The word-ratio floor
    // ensures we never trade a full JSON-LD body for a truncated Readability
    // stub on providers where JSON-LD is canonical because Readability is weak.
    const ldImgs = countImages(legacyBody);
    const readableImgs = countImages(readable.contentHtml);
    const ldWords = countWords(stripTags(legacyBody));
    const readableLongEnough = readable.wordCount >= ldWords * READABILITY_LD_MIN_WORD_RATIO;
    if (ldImgs === 0 && readableImgs >= 1 && readableLongEnough) {
      chosenBody = readable.contentHtml;
    }
  }

  // --- Step 6: declutter (runs in BOTH paths) --------------------------------
  // Removes residual boilerplate the extractor leaves behind — most importantly
  // the trailing author byline/bio paragraph. Conservative: aborts removals
  // that would drop >35% of the text, so real article bodies are preserved.
  const decluttered = declutterArticleHtml(chosenBody, {
    byline: readable?.byline ?? author,
    authorName: author,
    publishedAt,
    providerKey: provider?.key,
  });

  // --- Step 7: final sanitization (always runs, never bypassed) -------------
  const content = sanitizeArticleHtml(decluttered).trim();
  const bodyText = stripTags(content);

  if (countWords(bodyText) < 50) {
    return null;
  }

  // Metadata fallbacks: only fill gaps with Readability-derived values; never
  // override existing JSON-LD/OG/meta values.
  author = author ?? readable?.byline ?? null;

  const description =
    (ld && jsonLdString(ld.description)) ??
    metaContent(cleanedHtml, "og:description") ??
    metaContent(cleanedHtml, "description") ??
    readable?.excerpt ??
    null;
  const excerpt = description ?? bodyText.slice(0, 240).trim() + (bodyText.length > 240 ? "…" : "");

  const wordCount = countWords(bodyText);
  const readingMinutes = Math.max(1, Math.round(wordCount / WORDS_PER_MINUTE));

  return {
    title: decodeEntities(title),
    author: author ? decodeEntities(author) : null,
    source: provider?.name ?? urlObj.hostname.replace(/^www\./, ""),
    sourceUrl,
    heroImage,
    excerpt: excerpt || null,
    content,
    category: resolveCategory(provider, urlObj, section),
    publishedAt,
    wordCount,
    readingMinutes,
  };
}

function safeDate(value: string): Date | null {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}
