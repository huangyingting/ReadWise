/**
 * Provider-level pre-extraction HTML cleanup (Epic #366 / Issue #367).
 *
 * Applies declarative noise-removal rules to raw page HTML **before** body
 * paragraphs are extracted. This reduces false-positive content (video
 * players, newsletter CTAs, related-article widgets, social-share toolbars,
 * promo banners, ad containers) without touching the extraction or
 * sanitization logic.
 *
 * Implementation notes
 * --------------------
 * We use `sanitize-html` (already a project dependency) with
 * `allowedTags: false` so ALL tags pass through by default — only the blocks
 * matched by `nonTextTags` or `exclusiveFilter` are removed. This gives us
 * correct nested-element removal without a full DOM parser (htmlparser2 is
 * the underlying engine). The result still goes through `sanitizeArticleHtml`
 * as the final, authoritative safety pass.
 */

import sanitizeHtml from "sanitize-html";
import type { Provider } from "@/lib/scraper/types";

/** Shape of the per-provider cleanup configuration. */
export type ProviderCleanup = NonNullable<Provider["cleanup"]>;

/**
 * Conservative site-chrome vocabulary applied to every provider before
 * extraction. Provider modules can add narrower site-specific terms, but these
 * generic class/id fragments cover common ad, recirculation, share, newsletter
 * and paywall widgets across the supported sources.
 */
export const GENERIC_PROVIDER_CLEANUP: ProviderCleanup = {
  dropClassKeywords: [
    "advertisement",
    "advert",
    "adsbygoogle",
    "ad-container",
    "ad_slot",
    "ad-unit",
    "sponsor",
    "sponsored",
    "promo",
    "promotion",
    "newsletter",
    "subscribe",
    "signup",
    "sign-up",
    "social-share",
    "share-tools",
    "share-buttons",
    "sharebar",
    "share this",
    "sharing",
    "related",
    "recommend",
    "recommended",
    "recirc",
    "read-more",
    "more-from",
    "up-next",
    "you-may-also",
    "trending",
    "most-popular",
    "outbrain",
    "taboola",
    "comment-section",
    "comments",
    "disqus",
    "cookie",
    "consent",
    "paywall",
    "modal",
    "overlay",
    "author-bio",
    "author-card",
    "byline-thumbnail",
  ],
};

/** Combines generic and provider-specific cleanup without duplicating rules. */
export function mergeProviderCleanup(
  ...cleanups: Array<ProviderCleanup | undefined | null>
): ProviderCleanup {
  const dropSelectors = new Set<string>();
  const dropClassKeywords = new Set<string>();
  for (const cleanup of cleanups) {
    for (const selector of cleanup?.dropSelectors ?? []) dropSelectors.add(selector);
    for (const keyword of cleanup?.dropClassKeywords ?? []) dropClassKeywords.add(keyword);
  }
  return {
    dropSelectors: [...dropSelectors],
    dropClassKeywords: [...dropClassKeywords],
  };
}

/**
 * Structural block-level tags whose `class`/`id` attributes are examined for
 * keyword matches. We intentionally exclude inline tags so that legitimate
 * prose (e.g. a `<span class="ad-label">`) is never inadvertently stripped.
 */
const BLOCK_CONTAINER_TAGS = new Set([
  "div",
  "section",
  "aside",
  "nav",
  "header",
  "footer",
  "article",
  "main",
  "figure",
  "form",
  "ul",
  "ol",
  "table",
]);

/**
 * Applies provider-level pre-extraction cleanup to raw page HTML.
 *
 * - `dropSelectors` tag names are removed **with all inner content** (the
 *   same mechanism as `sanitize-html`'s `nonTextTags`). Only bare tag names
 *   like `"video"` or `"iframe"` are accepted; entries with selector syntax
 *   (dots, hashes, spaces) are silently ignored.
 *
 * - `dropClassKeywords` fragments are matched case-insensitively against the
 *   `class` and `id` attributes of structural block elements. Any matching
 *   block — together with every element inside it — is removed.
 *
 * Returns the original string unchanged when no rules are provided.
 */
export function applyProviderCleanup(html: string, cleanup: ProviderCleanup): string {
  // Accept only plain tag names — reject selectors (.ad), IDs (#promo), etc.
  const dropTags = (cleanup.dropSelectors ?? []).filter((s) => /^[a-z][a-z0-9]*$/i.test(s));
  const keywords = cleanup.dropClassKeywords ?? [];

  // Early-exit: nothing to do.
  if (!dropTags.length && !keywords.length) return html;

  return sanitizeHtml(html, {
    // Pass ALL tags through — we only want to remove the listed noise blocks.
    // Without this setting sanitize-html would strip every unrecognised tag,
    // corrupting the HTML before the real sanitization pass runs.
    // `allowVulnerableTags` silences the library's warning: the output is
    // never served to users directly — it always passes through the strict
    // `sanitizeArticleHtml` pass afterwards.
    allowedTags: false,
    allowedAttributes: false,
    allowVulnerableTags: true,

    // Use exclusiveFilter for ALL removal (both tag-based and keyword-based).
    // Note: nonTextTags only removes content when the tag is NOT in allowedTags,
    // which is never the case here (allowedTags: false = allow all).
    // exclusiveFilter removes the matched element AND all its inner content,
    // which is exactly the behaviour we need.
    exclusiveFilter: (frame) => {
      // Tag-based drop: matches any of the plain tag names in dropSelectors.
      if (dropTags.includes(frame.tag)) return true;
      // Keyword-based drop: matches block container elements whose class/id
      // contains any of the specified keyword fragments.
      if (keywords.length && BLOCK_CONTAINER_TAGS.has(frame.tag)) {
        const haystack = [
          frame.attribs?.class,
          frame.attribs?.id,
          frame.attribs?.role,
          frame.attribs?.["aria-label"],
          frame.attribs?.["data-testid"],
          frame.attribs?.["data-test-id"],
          frame.attribs?.["data-component"],
          frame.attribs?.["data-module"],
          frame.attribs?.["data-ad"],
        ]
          .filter(Boolean)
          .join(" ");
        return keywords.some((kw) => haystack.toLowerCase().includes(kw.toLowerCase()));
      }
      return false;
    },
  });
}
