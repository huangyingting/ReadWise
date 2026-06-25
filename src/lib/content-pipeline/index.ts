/**
 * Content transformation and HTML safety pipeline — REF-072.
 *
 * Authoritative subsystem for the ReadWise content transformation sequence:
 *
 *   raw provider HTML
 *     → (Stage 1) provider cleanup       [@/lib/scraper/cleanup]
 *     → (Stage 2) HTML normalization     [@/lib/scraper/normalize]
 *     → (Stage 3) strict sanitization    [this module — SECURITY BOUNDARY]
 *     → (Stage 4) reader text extraction [this module]
 *     → (Stage 5) paragraph splitting    [@/lib/bilingual]
 *
 * ## Stage descriptions
 *
 * ### Stage 1 — Provider cleanup  (scraper-specific, optional)
 * `applyProviderCleanup` removes noise blocks (video players, newsletter CTAs,
 * social-share toolbars, ad containers) from raw provider HTML before body
 * extraction. Declarative per-provider rules defined in `@/lib/scraper/cleanup`.
 * NOT a security boundary — sanitization always follows.
 *
 * ### Stage 2 — HTML normalization  (scraper-specific, optional)
 * `normalizeArticleHtml` strips `<script>`, `<style>`, inline event handlers,
 * and HTML comments before body extraction. Enabled via the environment variable
 * `SCRAPER_HTML_NORMALIZE=true`. Defined in `@/lib/scraper/normalize`.
 * NOT a security boundary — sanitization always follows.
 *
 * ### Stage 3 — Strict sanitization  ← SECURITY BOUNDARY
 * `sanitizeArticleHtml` is the ONLY authoritative stored/rendered HTML
 * sanitizer. Every article HTML fragment that is stored in the database or
 * rendered in the reader MUST pass through it. The two-pass approach
 * (boilerplate drop → strict allow-list) and the tag/attribute allow-list MUST
 * NOT be changed without a security review.
 *
 * ### Stage 4 — Reader text extraction
 * `articleHtmlToReaderText` produces the canonical plain-text basis from
 * sanitized stored HTML. All features that consume article text — TTS,
 * dictation, pronunciation, highlight anchoring, vocabulary lookups, difficulty
 * scoring, translation input, and metadata descriptions — MUST derive their
 * plain text from this function so that word-boundary positions are consistent
 * across features.
 *
 * `htmlToPlainText` was a deprecated backwards-compatible alias; removed in REF-009.
 *
 * ### Stage 5 — Paragraph splitting  (bilingual/parallel view)
 * `splitHtmlParagraphs`, `splitTranslationParagraphs`, and `alignParagraphs`
 * split sanitized HTML and translated text into block-level chunks for the
 * bilingual parallel reading view. These helpers are pure and client-safe;
 * import them from `@/lib/bilingual` when needed in client components.
 */

import { sanitizeArticleHtml as _sanitizeArticleHtml } from "@/lib/sanitize";

// ---------------------------------------------------------------------------
// Stage 3 — Strict sanitization (the security boundary)
// ---------------------------------------------------------------------------

/**
 * Sanitize stored article HTML into a clean, distraction-free body.
 *
 * Two-pass operation:
 *  1. Drops ad/boilerplate blocks (together with their inner content).
 *  2. Strips any remaining non-allowlisted tags and unsafe attributes/schemes;
 *     rewrites all anchor links to add `rel=noopener noreferrer nofollow` and
 *     `target=_blank`.
 *
 * This is the **only** authoritative sanitizer for stored or rendered article
 * HTML. Never render stored or scraped article HTML without passing it through
 * this function first.
 */
export const sanitizeArticleHtml: (html: string) => string = _sanitizeArticleHtml;

// ---------------------------------------------------------------------------
// Stage 4 — Reader text extraction
// ---------------------------------------------------------------------------

/**
 * Decodes common HTML entities from a post-sanitization string.
 *
 * Handles both numeric (`&#x26;`, `&#38;`) and named (`&amp;`, `&quot;`, …)
 * entities that may remain in text content after tag stripping. This is an
 * internal helper — callers should use `articleHtmlToReaderText` instead.
 */
function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => {
      try {
        return String.fromCodePoint(parseInt(hex, 16));
      } catch {
        return "";
      }
    })
    .replace(/&#(\d+);/g, (_, dec: string) => {
      try {
        return String.fromCodePoint(parseInt(dec, 10));
      } catch {
        return "";
      }
    })
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

/**
 * Converts stored article HTML into the canonical reader text basis.
 *
 * Applies `sanitizeArticleHtml` first so that the plain-text output always
 * reflects what would be rendered in the reader — tag-stripped, entity-decoded,
 * and whitespace-normalised.
 *
 * All features that require plain text from article content — TTS, dictation,
 * pronunciation alignment, highlight anchoring, vocabulary lookups, difficulty
 * scoring, translation input, and metadata descriptions — MUST use this
 * function so that word-boundary positions are consistent across features.
 */
export function articleHtmlToReaderText(html: string): string {
  return decodeHtmlEntities(_sanitizeArticleHtml(html).replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?%\)\]\}])/g, "$1")
    .replace(/([\(\[\{])\s+/g, "$1")
    .trim();
}

