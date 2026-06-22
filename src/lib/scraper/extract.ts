import { sanitizeArticleHtml } from "@/lib/sanitize";
import { isValidCategorySlug } from "@/lib/categories";
import type { Provider, ScrapedArticle } from "@/lib/scraper/types";
import { mapSectionToCategory, providerForUrl } from "@/lib/scraper/providers";
import { assertSafeUrl } from "@/lib/scraper/ssrf";

const WORDS_PER_MINUTE = 200;
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/124.0 Safari/537.36 ReadWiseBot/1.0";

/** Max redirect hops followed before giving up. */
const MAX_REDIRECTS = 5;

/** Fetches a URL as text with a desktop UA and a timeout. Throws on non-2xx or unsafe target. */
export async function fetchHtml(url: string, timeoutMs = 15000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let currentUrl = url;
    // Follow redirects manually so EVERY hop's host is re-validated through the
    // SSRF guard. With `redirect: "follow"` the runtime re-resolves DNS and only
    // the final hostname could be checked, leaving a DNS-rebinding / SSRF window
    // where an intermediate hop points at a private/loopback/metadata address.
    for (let hop = 0; ; hop++) {
      // Validate scheme + resolved IP of this hop before fetching it.
      await assertSafeUrl(currentUrl);

      const res = await fetch(currentUrl, {
        headers: { "user-agent": USER_AGENT, accept: "text/html" },
        signal: controller.signal,
        redirect: "manual",
      });

      const location = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && location) {
        if (hop >= MAX_REDIRECTS) {
          throw new Error(`Too many redirects (> ${MAX_REDIRECTS}) starting from ${url}`);
        }
        // Resolve relative redirects against the current URL; the next loop
        // iteration re-validates the resulting host before fetching it.
        currentUrl = new URL(location, currentUrl).href;
        continue;
      }

      if (!res.ok) {
        throw new Error(`HTTP ${res.status} for ${currentUrl}`);
      }
      return await res.text();
    }
  } finally {
    clearTimeout(timer);
  }
}

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
 */
export function extractArticle(html: string, sourceUrl: string): ScrapedArticle | null {
  const provider = providerForUrl(sourceUrl);
  let urlObj: URL;
  try {
    urlObj = new URL(sourceUrl);
  } catch {
    return null;
  }

  const ld = extractArticleJsonLd(html);

  const title =
    (ld && (jsonLdString(ld.headline) ?? jsonLdString(ld.name))) ??
    metaContent(html, "og:title") ??
    (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
      ? decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)![1]).trim()
      : null);

  if (!title) return null;

  const author =
    (ld && jsonLdAuthor(ld.author)) ??
    metaContent(html, "author") ??
    metaContent(html, "article:author");

  const heroImage = toAbsolute(
    (ld && jsonLdImage(ld.image)) ?? metaContent(html, "og:image"),
    sourceUrl,
  );

  const section =
    (ld && jsonLdString(ld.articleSection)) ??
    metaContent(html, "article:section") ??
    metaContent(html, "og:article:section");

  const publishedRaw =
    (ld && jsonLdString(ld.datePublished)) ??
    metaContent(html, "article:published_time") ??
    metaContent(html, "datePublished");
  const publishedAt = publishedRaw ? safeDate(publishedRaw) : null;

  const ldBody = ld && jsonLdString(ld.articleBody);
  const rawBody = ldBody ? paragraphsToHtml(ldBody) : extractBodyHtml(html);
  const content = sanitizeArticleHtml(rawBody).trim();
  const bodyText = stripTags(content);

  if (countWords(bodyText) < 50) {
    return null;
  }

  const description =
    (ld && jsonLdString(ld.description)) ??
    metaContent(html, "og:description") ??
    metaContent(html, "description");
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
