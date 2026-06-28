/**
 * Optional HTML normalization pass for the scraper pipeline (Epic #366 / Issue #368).
 *
 * Strips lightweight noise (scripts, styles, inline event handlers, inline
 * style attributes, HTML comments) from raw page HTML **before** body
 * extraction. All content-bearing elements (paragraphs, headings, lists,
 * links, images) are preserved unchanged.
 *
 * **Disabled by default.** Enable by setting the environment variable
 * `SCRAPER_HTML_NORMALIZE=true` (or pass `{ force: true }` in tests).
 *
 * `sanitizeArticleHtml` always runs AFTER normalization — normalization is
 * NOT a security boundary.
 *
 * Design rationale
 * ----------------
 * Uses regex/string operations (no full DOM parser) consistent with the rest
 * of the scraper pipeline. The patterns are conservative and well-commented
 * so they can be audited and tested in isolation. Each pattern targets a
 * specific noise category; the full list is small and stable.
 */

import { createLogger } from "@/lib/observability/logger";
import { scraperHtmlNormalize } from "@/lib/runtime-config/scraper";

const log = createLogger("scraper.normalize");

// ---------------------------------------------------------------------------
// Regex patterns
// ---------------------------------------------------------------------------

/**
 * Tags that carry no visible content and should be removed along with
 * everything inside them: scripts, stylesheets, `<noscript>` fallbacks, and
 * `<template>` elements. The backreference `\1` ensures open/close tags match.
 *
 * Handles multi-line content via `[\s\S]*?` (non-greedy).
 */
const STRIP_WITH_CONTENT_RE =
  /<(script|style|noscript|template)\b[^>]*>[\s\S]*?<\/\1>/gi;

/**
 * Unconditionally strip `<script>`, `<style>`, `<noscript>` and `<template>`
 * elements (and their inner content) from HTML.
 *
 * Unlike {@link normalizeArticleHtml} this is **never gated** behind the
 * `SCRAPER_HTML_NORMALIZE` flag — it is always safe and always desirable for
 * the HTML used during BODY extraction, where leftover inline script/style
 * text would otherwise leak into harvested `<p>` paragraphs or the Readability
 * body. It must only be applied AFTER JSON-LD metadata has been read (JSON-LD
 * lives inside `<script type="application/ld+json">`), never before.
 */
export function stripScriptsAndStyles(html: string): string {
  return html.replace(STRIP_WITH_CONTENT_RE, "");
}

/**
 * Inline event-handler attributes: `onclick="…"`, `onerror='…'`, etc.
 * Matches the leading whitespace so the tag's remaining text stays clean.
 * Covers double-quoted, single-quoted, and unquoted values.
 */
const INLINE_EVENTS_RE = /\s+on[a-z][a-z0-9]*\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;

/**
 * Inline `style` attributes (double-quoted or single-quoted only — the
 * unquoted form is rare enough and risky enough to skip).
 */
const INLINE_STYLE_RE = /\s+style\s*=\s*(?:"[^"]*"|'[^']*')/gi;

/** Standard HTML comments `<!-- … -->`. Handles multi-line content. */
const COMMENTS_RE = /<!--[\s\S]*?-->/g;

/** Three or more consecutive newlines collapsed to two. */
const BLANK_LINES_RE = /\n{3,}/g;

/** Two or more consecutive horizontal whitespace characters collapsed to one. */
const SPACES_RE = /[ \t]{2,}/g;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Return value of {@link normalizeArticleHtml}.
 *
 * `compressionRatio = normalizedLength / originalLength`. Values below 1.0
 * indicate the HTML was reduced in size. Always exactly `1` when
 * normalization is disabled.
 */
export type NormalizeResult = {
  /** Simplified HTML, or the original string when normalization is off. */
  html: string;
  /** UTF-8 byte length of the input HTML. */
  originalLength: number;
  /** UTF-8 byte length of the output HTML. */
  normalizedLength: number;
  /** Ratio of output size to input size (0–∞; `1` means unchanged). */
  compressionRatio: number;
};

/** Options accepted by {@link normalizeArticleHtml}. */
export type NormalizeOptions = {
  /**
   * Bypass the `SCRAPER_HTML_NORMALIZE` environment variable guard and force
   * normalization on regardless.  Intended for tests only.
   */
  force?: boolean;
};

/**
 * Optional HTML normalization pass — **disabled by default**.
 *
 * When enabled (via `SCRAPER_HTML_NORMALIZE=true` or `opts.force = true`):
 * - Strips `<script>`, `<style>`, `<noscript>`, `<template>` with content.
 * - Removes inline event-handler attributes (`onclick`, `onerror`, …).
 * - Removes inline `style` attributes.
 * - Strips HTML comments.
 * - Collapses redundant whitespace runs.
 *
 * Content-bearing elements (paragraphs, headings, lists, links, images) are
 * **never** removed — normalization is purely reductive.
 *
 * When disabled, returns the original HTML string without any allocation.
 */
export function normalizeArticleHtml(html: string, opts: NormalizeOptions = {}): NormalizeResult {
  const enabled = opts.force === true || scraperHtmlNormalize();
  const originalLength = Buffer.byteLength(html, "utf8");

  if (!enabled) {
    return { html, originalLength, normalizedLength: originalLength, compressionRatio: 1 };
  }

  // Apply each transformation in order.  Patterns are non-overlapping, so
  // order matters only for readability / performance (heavier removals first).
  const normalized = html
    .replace(STRIP_WITH_CONTENT_RE, "")
    .replace(COMMENTS_RE, "")
    .replace(INLINE_EVENTS_RE, "")
    .replace(INLINE_STYLE_RE, "")
    .replace(BLANK_LINES_RE, "\n\n")
    .replace(SPACES_RE, " ");

  const normalizedLength = Buffer.byteLength(normalized, "utf8");
  const compressionRatio = originalLength > 0 ? normalizedLength / originalLength : 0;

  log.debug("html normalized", {
    originalLength,
    normalizedLength,
    compressionRatio: compressionRatio.toFixed(3),
  });

  return { html: normalized, originalLength, normalizedLength, compressionRatio };
}
