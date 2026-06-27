import { parseHTML } from "linkedom";
import { Readability } from "@mozilla/readability";

/**
 * DOM-based main-article extractor for the scraper pipeline.
 *
 * Isolates the primary article from raw page HTML using `linkedom` (a
 * server-side DOM) plus Mozilla's `@mozilla/readability` content algorithm —
 * the same engine Firefox Reader View uses. This strips chrome such as
 * navigation, headers, footers, sidebars and related-story widgets, leaving the
 * clean article markup.
 *
 * The HTML returned here is **not** the final safe HTML: the authoritative
 * `sanitizeArticleHtml` allowlist pass runs downstream in `extract.ts`, so this
 * module only isolates content and does not enforce an XSS allowlist itself.
 *
 * @server-only — `linkedom` is a Node-only dependency. Must never be imported
 * from a "use client" file or any module that can enter a client bundle.
 */

/** Minimum body length (in words) for a result to count as a real article. */
const MIN_WORD_COUNT = 50;

/**
 * The extracted main article, shaped for easy consumption by `extract.ts`.
 *
 * `contentHtml` is the inner article markup with Readability's
 * `<div id="readability-page-1">` wrapper unwrapped; it still needs the
 * downstream sanitize pass before persistence.
 */
export interface ReadableArticle {
  /** Article title Readability detected, or `null` when none was found. */
  title: string | null;
  /**
   * Author string Readability detected from bylines/metadata. Exposed so the
   * integration layer can strip a trailing duplicate author paragraph.
   */
  byline: string | null;
  /** Inner article HTML (Readability wrapper unwrapped). */
  contentHtml: string;
  /** Plain-text rendering of the article body, tags removed. */
  textContent: string;
  /** Short excerpt / description Readability derived, or `null`. */
  excerpt: string | null;
  /** Detected content language (e.g. `"en"`), or `null`. */
  lang: string | null;
  /** Detected site name, or `null`. */
  siteName: string | null;
  /** Word count computed from `textContent`. */
  wordCount: number;
}

/** Counts whitespace-delimited tokens, matching extract.ts's `countWords`. */
function countWords(text: string): number {
  const matches = text.match(/\S+/g);
  return matches ? matches.length : 0;
}

/**
 * Injects a `<base href>` into the document head so Readability resolves
 * relative links/images against the source URL. No-op when a `<base>` already
 * exists or there is no `<head>` to anchor to.
 */
function withBaseHref(html: string, url: string): string {
  if (/<base\b/i.test(html)) return html;
  if (!/<head[^>]*>/i.test(html)) return html;
  return html.replace(/<head([^>]*)>/i, `<head$1><base href="${url}">`);
}

/**
 * Removes Readability's outer `<div id="readability-page-1" class="page">`
 * wrapper, returning the clean inner article markup. Falls back to the original
 * string when the wrapper is absent.
 */
function unwrapReadabilityPage(content: string): string {
  try {
    const { document } = parseHTML(`<body>${content}</body>`);
    const page = document.getElementById("readability-page-1");
    if (page) return page.innerHTML.trim();
  } catch {
    // Fall through to returning the raw content.
  }
  return content.trim();
}

/** Trims a Readability string field to a non-empty value or `null`. */
function nullableString(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Extracts the main article from already-fetched page HTML.
 *
 * Parses `html` with linkedom, runs Readability against the document, and
 * returns a {@link ReadableArticle}. A base URL is injected so relative
 * links/images resolve against `url`.
 *
 * Never throws and never fetches: the input is HTML already retrieved by the
 * scraper's SSRF-safe fetcher. Returns `null` when extraction yields nothing,
 * the title is empty, the body is shorter than {@link MIN_WORD_COUNT} words, or
 * any parse error occurs — so callers can treat `null` as "not a real article".
 */
export function extractReadable(html: string, url: string): ReadableArticle | null {
  try {
    if (!html || !html.trim()) return null;

    const { document } = parseHTML(withBaseHref(html, url));
    // linkedom's document is structurally compatible with Readability's DOM.
    const article = new Readability(document as unknown as Document).parse();
    if (!article) return null;

    const title = nullableString(article.title);
    if (!title) return null;

    const textContent = (article.textContent ?? "").replace(/\s+/g, " ").trim();
    const wordCount = countWords(textContent);
    if (wordCount < MIN_WORD_COUNT) return null;

    const rawContent = typeof article.content === "string" ? article.content : "";
    const contentHtml = unwrapReadabilityPage(rawContent);
    if (!contentHtml) return null;

    return {
      title,
      byline: nullableString(article.byline),
      contentHtml,
      textContent,
      excerpt: nullableString(article.excerpt),
      lang: nullableString(article.lang),
      siteName: nullableString(article.siteName),
      wordCount,
    };
  } catch {
    return null;
  }
}
