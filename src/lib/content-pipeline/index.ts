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
 * `articleHtmlToReaderText` and `articleHtmlToReaderBlocks` produce the
 * canonical plain-text basis from sanitized stored HTML. The extraction is
 * DOM-based so text order follows the rendered reader tree while still
 * normalizing whitespace for stable offsets. All features that consume article
 * text — TTS, dictation, pronunciation, highlight anchoring, vocabulary lookups,
 * difficulty scoring, translation input, and metadata descriptions — MUST
 * derive their plain text from these helpers so that word-boundary positions are
 * consistent across features.
 *
 * ### Stage 5 — Paragraph splitting  (bilingual/parallel view)
 * `splitHtmlParagraphs`, `splitTranslationParagraphs`, and `alignParagraphs`
 * split sanitized HTML and translated text into block-level chunks for the
 * bilingual parallel reading view. These helpers are pure and client-safe;
 * import them from `@/lib/bilingual` when needed in client components.
 */

import { parseHTML } from "linkedom";
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

const READER_BLOCK_TAGS = new Set([
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "li",
  "blockquote",
  "figcaption",
  "caption",
  "td",
  "th",
  "pre",
]);

const READER_BREAK_TAGS = new Set(["br", "hr"]);

const READER_CONTAINER_TAGS = new Set(["ul", "ol", "table", "thead", "tbody", "tr", "figure"]);

export type ArticleReaderText = {
  /**
   * Canonical reader plain text. Blocks are joined with a single space so
   * offsets remain compatible with the reader's DOM text-node mapper, which
   * tolerates inserted normalized whitespace between rendered nodes.
   */
  plainText: string;
  /** Reader-visible block chunks in DOM order, suitable for SSML paragraph turns. */
  blocks: string[];
};

function normalizeReaderText(input: string): string {
  return input
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?%\)\]\}])/g, "$1")
    .replace(/([\(\[\{])\s+/g, "$1")
    .trim();
}

function isElementNode(node: Node): node is Element {
  return node.nodeType === 1;
}

function isTextNode(node: Node): node is Text {
  return node.nodeType === 3;
}

function tagName(node: Element): string {
  return node.tagName.toLowerCase();
}

function readerTextFromNode(node: Node): string {
  if (isTextNode(node)) return node.nodeValue ?? "";
  if (!isElementNode(node)) return "";
  if (READER_BREAK_TAGS.has(tagName(node))) return " ";

  const parts: string[] = [];
  for (const child of Array.from(node.childNodes)) {
    const text = readerTextFromNode(child);
    if (!text) continue;
    parts.push(isTextNode(child) ? text : ` ${text} `);
  }
  return parts.join("");
}

function pushNormalizedBlock(blocks: string[], value: string): void {
  const normalized = normalizeReaderText(value);
  if (normalized) blocks.push(normalized);
}

/**
 * Converts stored article HTML into canonical reader text blocks.
 *
 * Applies `sanitizeArticleHtml` first, then walks the sanitized fragment as DOM
 * so text order matches the rendered reader. Inline element boundaries are
 * normalized as whitespace to preserve stable word offsets across markup changes.
 *
 * All features that require plain text from article content — TTS, dictation,
 * pronunciation alignment, highlight anchoring, vocabulary lookups, difficulty
 * scoring, translation input, and metadata descriptions — MUST use these
 * helpers so that word-boundary positions are consistent across features.
 */
export function articleHtmlToReaderBlocks(html: string): ArticleReaderText {
  const sanitized = _sanitizeArticleHtml(html);
  const { document } = parseHTML(`<main id="readwise-reader-text-root">${sanitized}</main>`);
  const root = document.getElementById("readwise-reader-text-root");
  if (!root) return { plainText: "", blocks: [] };

  const blocks: string[] = [];
  const inlineParts: string[] = [];

  const flushInline = () => {
    if (inlineParts.length === 0) return;
    pushNormalizedBlock(blocks, inlineParts.join(""));
    inlineParts.length = 0;
  };

  const walkChildren = (parent: Node) => {
    for (const child of Array.from(parent.childNodes)) {
      if (isTextNode(child)) {
        inlineParts.push(child.nodeValue ?? "");
        continue;
      }
      if (!isElementNode(child)) continue;

      const tag = tagName(child);
      if (READER_BREAK_TAGS.has(tag)) {
        inlineParts.push(" ");
        continue;
      }
      if (READER_BLOCK_TAGS.has(tag)) {
        flushInline();
        pushNormalizedBlock(blocks, readerTextFromNode(child));
        continue;
      }
      if (READER_CONTAINER_TAGS.has(tag)) {
        walkChildren(child);
        continue;
      }
      inlineParts.push(` ${readerTextFromNode(child)} `);
    }
  };

  walkChildren(root);
  flushInline();

  const plainText = normalizeReaderText(blocks.join(" "));
  return { plainText, blocks };
}

export function articleHtmlToReaderText(html: string): string {
  return articleHtmlToReaderBlocks(html).plainText;
}
