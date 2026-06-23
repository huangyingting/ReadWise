import { sanitizeArticleHtml } from "@/lib/sanitize";
import { isValidCategorySlug } from "@/lib/categories";
import type { Provider, ScrapedArticle } from "@/lib/scraper/types";
import { mapSectionToCategory, providerForUrl } from "@/lib/scraper/providers";
import { resolveAndPin, type PinnedAddress } from "@/lib/scraper/ssrf";
import { scraperMaxBytes, scraperTimeoutMs } from "@/lib/scraper/limits";
import { withSpan } from "@/lib/tracing";
import { Agent, fetch as undiciFetch } from "undici";

const WORDS_PER_MINUTE = 200;
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/124.0 Safari/537.36 ReadWiseBot/1.0";

/** Max redirect hops followed before giving up. */
const MAX_REDIRECTS = 5;

/**
 * Builds a one-shot undici dispatcher that PINS the connection to the exact
 * pre-validated IP. The `lookup` short-circuits DNS so undici never re-resolves
 * the hostname at connect time (closing the DNS-rebinding / TOCTOU gap), while
 * `fetch(url)` still sends the correct `Host` header and TLS SNI for vhosts.
 */
function pinnedDispatcher(pin: PinnedAddress): Agent {
  return new Agent({
    connect: {
      lookup: (_hostname, options, callback) => {
        // undici/net may request all addresses (`all: true`) and then expects an
        // array; otherwise it expects the single (err, address, family) form.
        if (options && (options as { all?: boolean }).all) {
          callback(null, [{ address: pin.ip, family: pin.family }]);
        } else {
          callback(null, pin.ip, pin.family);
        }
      },
    },
  });
}

/** Fetches a URL as text with a desktop UA, a hard timeout and a body-size cap. Throws on non-2xx or unsafe target. */
export async function fetchHtml(url: string, timeoutMs = scraperTimeoutMs()): Promise<string> {
  let host = "unknown";
  try {
    host = new URL(url).hostname;
  } catch {
    // keep "unknown" — never put a raw/invalid URL on a span attribute
  }
  // Child span around the provider fetch. Only the hostname (low cardinality,
  // no path/query) is recorded so no article URL/content leaks into traces.
  return withSpan("scraper.fetch", { "readwise.provider": "scraper", "readwise.host": host }, async () => {
  const maxBytes = scraperMaxBytes();
  // A single AbortController bounds the TOTAL request budget — connect, every
  // redirect hop AND the streamed body read all share `controller.signal`, so a
  // slow server can't stall any phase past `timeoutMs`.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let currentUrl = url;
    // Follow redirects manually so EVERY hop's host is re-validated AND its IP
    // re-resolved + pinned through the SSRF guard. `fetch(hostname)` alone lets
    // undici re-resolve DNS at connect time, leaving a DNS-rebinding / SSRF
    // window where a host validated as public could connect to a private /
    // loopback / metadata address. Pinning the validated IP closes that gap.
    for (let hop = 0; ; hop++) {
      // Validate scheme, resolve+validate EVERY address, and pin one validated
      // IP for this hop before connecting to it.
      const pin = await resolveAndPin(currentUrl);
      const dispatcher = pinnedDispatcher(pin);

      let res: Awaited<ReturnType<typeof undiciFetch>>;
      try {
        res = await undiciFetch(currentUrl, {
          headers: { "user-agent": USER_AGENT, accept: "text/html" },
          signal: controller.signal,
          redirect: "manual",
          dispatcher,
        });
      } catch (err) {
        void dispatcher.close();
        throw err;
      }

      const location = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && location) {
        // Drain + release the redirect response body before moving on so the
        // pinned dispatcher's socket is freed promptly.
        await res.body?.cancel().catch(() => {});
        void dispatcher.close();
        if (hop >= MAX_REDIRECTS) {
          throw new Error(`Too many redirects (> ${MAX_REDIRECTS}) starting from ${url}`);
        }
        // Resolve relative redirects against the current URL; the next loop
        // iteration re-validates + re-pins the resulting host before fetching it.
        currentUrl = new URL(location, currentUrl).href;
        continue;
      }

      try {
        if (!res.ok) {
          throw new Error(`HTTP ${res.status} for ${currentUrl}`);
        }
        // Stream the body with a hard byte cap — never trust Content-Length
        // alone; count bytes as they arrive and abort once the cap is exceeded.
        return await readBodyWithLimit(res, maxBytes);
      } finally {
        // Tear down the per-hop dispatcher once the body has been read/aborted.
        void dispatcher.close();
      }
    }
  } finally {
    clearTimeout(timer);
  }
  });
}

type FetchResponse = Awaited<ReturnType<typeof undiciFetch>>;

/**
 * Reads a response body as UTF-8 text while enforcing `maxBytes`.
 *
 * Defense in depth against oversized / decompression-bomb responses:
 *  1. Reject up-front when a declared `Content-Length` already exceeds the cap.
 *  2. Stream the body and count bytes as they arrive, aborting (cancelling the
 *     stream) the moment the running total would exceed the cap — Content-Length
 *     is advisory and may be absent or lie, so the streaming count is the real
 *     guard.
 *
 * Falls back to `res.text()` for response shapes without a readable stream
 * (still size-checked after the fact).
 */
async function readBodyWithLimit(res: FetchResponse, maxBytes: number): Promise<string> {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error(`Response too large: ${declared} bytes exceeds limit of ${maxBytes} bytes`);
  }

  const body = res.body as ReadableStream<Uint8Array> | null | undefined;
  if (!body || typeof body.getReader !== "function") {
    const text = await res.text();
    if (Buffer.byteLength(text, "utf8") > maxBytes) {
      throw new Error(`Response too large: exceeds limit of ${maxBytes} bytes`);
    }
    return text;
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        throw new Error(`Response too large: exceeds limit of ${maxBytes} bytes`);
      }
      chunks.push(value);
    }
  } finally {
    // Cancel releases the lock and tells undici to abort any unread body.
    await reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks).toString("utf8");
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
