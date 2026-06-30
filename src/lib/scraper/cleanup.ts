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
import { parseHTML } from "linkedom";
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
  const dropTextKeywords = new Set<string>();
  const dropLinkHrefKeywords = new Set<string>();
  let dropFigcaptions = false;
  for (const cleanup of cleanups) {
    for (const selector of cleanup?.dropSelectors ?? []) dropSelectors.add(selector);
    for (const keyword of cleanup?.dropClassKeywords ?? []) dropClassKeywords.add(keyword);
    for (const keyword of cleanup?.dropTextKeywords ?? []) dropTextKeywords.add(keyword);
    for (const keyword of cleanup?.dropLinkHrefKeywords ?? []) dropLinkHrefKeywords.add(keyword);
    dropFigcaptions ||= cleanup?.dropFigcaptions === true;
  }
  return {
    dropSelectors: [...dropSelectors],
    dropClassKeywords: [...dropClassKeywords],
    dropTextKeywords: [...dropTextKeywords],
    dropLinkHrefKeywords: [...dropLinkHrefKeywords],
    ...(dropFigcaptions ? { dropFigcaptions } : {}),
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

const TEXT_KEYWORD_BLOCK_SELECTOR =
  "p,div,section,aside,nav,header,footer,figure,form,ul,ol,table,blockquote,h1,h2,h3,h4,h5,h6";
const DROP_TEXT_KEYWORD_MAXLEN = 1000;

function isEmptyArticleContainer(el: Element): boolean {
  return (
    (el.textContent ?? "").trim().length === 0 &&
    el.querySelector("img,a,iframe,video,table,object,embed") === null
  );
}

function removeEmptyArticleContainers(root: ParentNode): void {
  let removed = false;
  do {
    removed = false;
    for (const el of Array.from(root.querySelectorAll("p,figure")).reverse()) {
      if (!isEmptyArticleContainer(el)) continue;
      el.remove();
      removed = true;
    }
  } while (removed);
}

function dropLinkHrefMatches(html: string, keywords: string[]): string {
  const normalizedKeywords = keywords.map((kw) => kw.trim().toLowerCase()).filter(Boolean);
  if (!normalizedKeywords.length) return html;

  try {
    const { document } = parseHTML(html);
    for (const anchor of Array.from(document.querySelectorAll("a[href]"))) {
      const href = (anchor.getAttribute("href") ?? "").toLowerCase();
      if (normalizedKeywords.some((kw) => href.includes(kw))) anchor.remove();
    }
    removeEmptyArticleContainers(document);
    return document.toString();
  } catch {
    return html;
  }
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function blockTextForKeywordMatch(el: Element): string {
  const parts = [el.textContent ?? ""];
  for (const media of Array.from(el.querySelectorAll("img,svg"))) {
    parts.push(media.getAttribute("alt") ?? "", media.getAttribute("title") ?? "");
  }
  return normalizeText(parts.filter(Boolean).join(" "));
}

function dropTextKeywordMatches(html: string, keywords: string[]): string {
  const normalizedKeywords = keywords.map((kw) => normalizeText(kw)).filter(Boolean);
  if (!normalizedKeywords.length) return html;

  try {
    const { document } = parseHTML(html);
    for (const el of Array.from(document.querySelectorAll(TEXT_KEYWORD_BLOCK_SELECTOR)).reverse()) {
      const text = blockTextForKeywordMatch(el);
      if (text.length === 0 || text.length > DROP_TEXT_KEYWORD_MAXLEN) continue;
      if (normalizedKeywords.some((kw) => text.includes(kw))) el.remove();
    }
    removeEmptyArticleContainers(document);
    return document.toString();
  } catch {
    return html;
  }
}

function dropFigcaptionElements(html: string, enabled: boolean): string {
  if (!enabled) return html;
  try {
    const { document } = parseHTML(html);
    for (const caption of Array.from(document.querySelectorAll("figcaption"))) {
      caption.remove();
    }
    removeEmptyArticleContainers(document);
    return document.toString();
  } catch {
    return html;
  }
}

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
 * - `dropTextKeywords` fragments are matched case-insensitively against short
 *   block text. Matching blocks and children are removed.
 *
 * - `dropLinkHrefKeywords` fragments are matched case-insensitively against
 *   `<a href>`. Matching anchors and their children are removed, then empty
 *   `<p>`/`<figure>` wrappers left behind are removed.
 *
 * - `dropFigcaptions` removes `<figcaption>` elements while preserving sibling
 *   image/video content in the surrounding figure.
 *
 * Returns the original string unchanged when no rules are provided.
 */
export function applyProviderCleanup(html: string, cleanup: ProviderCleanup): string {
  // Accept only plain tag names — reject selectors (.ad), IDs (#promo), etc.
  const dropTags = (cleanup.dropSelectors ?? []).filter((s) => /^[a-z][a-z0-9]*$/i.test(s));
  const keywords = cleanup.dropClassKeywords ?? [];
  const textKeywords = cleanup.dropTextKeywords ?? [];
  const hrefKeywords = cleanup.dropLinkHrefKeywords ?? [];
  const dropFigcaptions = cleanup.dropFigcaptions === true;

  // Early-exit: nothing to do.
  if (
    !dropTags.length &&
    !keywords.length &&
    !textKeywords.length &&
    !hrefKeywords.length &&
    !dropFigcaptions
  ) {
    return html;
  }

  const cleaned =
    dropTags.length || keywords.length
      ? sanitizeHtml(html, {
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
        })
      : html;
  return dropTextKeywordMatches(
    dropFigcaptionElements(dropLinkHrefMatches(cleaned, hrefKeywords), dropFigcaptions),
    textKeywords,
  );
}
