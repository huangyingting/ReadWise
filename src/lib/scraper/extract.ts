import { sanitizeArticleHtml } from "@/lib/sanitize";
import { isValidCategorySlug } from "@/lib/categories";
import type { Provider, ScrapedArticle } from "@/lib/scraper/types";
import { mapSectionToCategory, providerForUrl } from "@/lib/scraper/providers";
import { applyProviderCleanup } from "@/lib/scraper/cleanup";
import { normalizeArticleHtml } from "@/lib/scraper/normalize";
import { extractReadable } from "@/lib/scraper/readability-extract";
import { declutterArticleHtml } from "@/lib/scraper/declutter";
import { scraperReadability } from "@/lib/runtime-config/scraper";

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

/** Extracts the raw body HTML from the page when JSON-LD has no articleBody. */
function extractBodyHtml(html: string): string {
  const articleMatch = html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i);
  const scope = articleMatch ? articleMatch[1] : html;
  const paragraphs = [...scope.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((m) => m[1].trim())
    .filter((p) => stripTags(p).length > 0);
  if (paragraphs.length === 0) return "";
  return paragraphs.map((p) => `<p>${p}</p>`).join("\n");
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
 * 1. **Provider cleanup** (optional, declarative): removes noise blocks such as
 *    video players, newsletter CTAs, social-share widgets and ad containers
 *    before any extraction takes place.
 * 2. **Metadata extraction**: JSON-LD, OpenGraph and `<meta>` tags are read
 *    from the cleaned HTML while `<script>` elements are still present.
 * 3. **HTML normalization** (optional, `SCRAPER_HTML_NORMALIZE=true`): strips
 *    scripts, styles, inline event handlers and style attributes to reduce
 *    noise in the HTML used for raw `<p>` body extraction.
 * 4. **Body extraction (clean capture)**: a Readability pass
 *    (`extractReadable`, gated by `SCRAPER_READABILITY`, default ON) isolates
 *    the main article from the cleaned page HTML. The legacy body — JSON-LD
 *    `articleBody` when present, otherwise a raw `<p>` harvest — is computed as
 *    a fallback. JSON-LD `articleBody` (canonical structured text) is always
 *    kept; for the noisier raw-`<p>` path Readability wins unless it appears to
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

  // --- Step 1: provider-specific pre-extraction cleanup (optional) ----------
  // Removes video/iframe/newsletter/social/ad blocks BEFORE any extraction so
  // their text content doesn't leak into paragraphs or word counts.
  const cleanedHtml = provider?.cleanup ? applyProviderCleanup(html, provider.cleanup) : html;

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
    metaContent(cleanedHtml, "og:article:section");

  const publishedRaw =
    (ld && jsonLdString(ld.datePublished)) ??
    metaContent(cleanedHtml, "article:published_time") ??
    metaContent(cleanedHtml, "datePublished");
  const publishedAt = publishedRaw ? safeDate(publishedRaw) : null;

  // --- Step 3: optional HTML normalization (disabled by default) -------------
  // Strips scripts/styles/inline-attrs from the HTML used for legacy body
  // extraction. JSON-LD was already read in step 2, so removing <script> here
  // is safe. When SCRAPER_HTML_NORMALIZE is not set the default path is unchanged.
  const { html: bodyHtml } = normalizeArticleHtml(cleanedHtml);

  // --- Step 4: build the legacy body (JSON-LD articleBody or raw <p> harvest)-
  // This is the fallback body and the canonical source when JSON-LD is present.
  const ldBody = ld && jsonLdString(ld.articleBody);
  const legacyBody = ldBody ? paragraphsToHtml(ldBody) : extractBodyHtml(bodyHtml);

  // --- Step 5: clean-capture body via Readability (kill-switch, default ON) --
  // Readability isolates the main article from the *cleaned* (not normalized)
  // HTML so it sees the full document structure for scoring.
  const readable = scraperReadability() ? extractReadable(cleanedHtml, sourceUrl) : null;

  // Choose the body robustly so we never lose article content:
  //  - JSON-LD articleBody is canonical structured text → always keep it.
  //  - For the noisier raw-<p> harvest, prefer Readability unless the legacy
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
  }

  // --- Step 6: declutter (runs in BOTH paths) --------------------------------
  // Removes residual boilerplate the extractor leaves behind — most importantly
  // the trailing author byline/bio paragraph. Conservative: aborts removals
  // that would drop >35% of the text, so real article bodies are preserved.
  const decluttered = declutterArticleHtml(chosenBody, {
    byline: readable?.byline ?? author,
    authorName: author,
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
