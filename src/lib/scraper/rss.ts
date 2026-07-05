/**
 * Lightweight RSS 2.0 / Atom feed URL extractor for provider discovery.
 *
 * Intentionally regex-based (no XML-parser dependency) — feeds are
 * well-structured enough that a targeted approach works reliably and keeps
 * the bundle small.
 */

export type RssEntry = {
  url: string;
  publishedAt?: string;
};

/**
 * Extracts article URLs from an RSS 2.0 or Atom feed XML string.
 *
 * Sources checked (in order):
 *   1. `<link>` text nodes (RSS 2.0 item links; `<link>` in the channel
 *      header is the homepage and is intentionally included so the caller's
 *      `articleUrlPattern` / `articleUrlFilter` can discard it).
 *   2. `<guid>` text nodes where `isPermaLink` is not explicitly `"false"`.
 *
 * Post-processing:
 *   - Query strings and `#` fragments are stripped.
 *   - Results are deduplicated (first occurrence wins).
 *   - Non-HTTP(S) strings and unparseable values are silently dropped.
 */
const RSS_LINK_TEXT_RE = /<link>\s*([^\s<]+)\s*<\/link>/gi;
const RSS_GUID_TEXT_RE = /<guid(\s[^>]*)?>([^<]+)<\/guid>/gi;
const NON_PERMALINK_GUID_RE = /isPermaLink\s*=\s*["']false["']/i;
const RSS_ITEM_BLOCK_RE = /<(?:item|entry)\b[^>]*>([\s\S]*?)<\/(?:item|entry)>/gi;

function collectRssUrlCandidates(xml: string): string[] {
  const candidates: string[] = [];

  // RSS 2.0: <link>https://…</link>  (text node, not an attribute)
  for (const match of xml.matchAll(RSS_LINK_TEXT_RE)) {
    candidates.push(match[1]);
  }

  // <guid> or <guid isPermaLink="true"> — treat as URL unless isPermaLink="false"
  for (const match of xml.matchAll(RSS_GUID_TEXT_RE)) {
    const attrs = match[1] ?? "";
    if (!NON_PERMALINK_GUID_RE.test(attrs)) {
      candidates.push(match[2].trim());
    }
  }

  return candidates;
}

function normalizeRssUrlCandidate(candidate: string): string | null {
  const trimmed = candidate.trim();
  if (!trimmed.startsWith("http")) return null;

  try {
    const url = new URL(trimmed);
    url.search = "";
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

export function parseRssUrls(xml: string): string[] {
  return parseRssEntries(xml).map((entry) => entry.url);
}

export function parseRssEntries(xml: string): RssEntry[] {
  const seen = new Set<string>();
  const clean: RssEntry[] = [];

  for (const entry of collectRssEntryCandidates(xml)) {
    const candidate = entry.url;
    const normalized = normalizeRssUrlCandidate(candidate);
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      const publishedAt = normalizeRssDate(entry.publishedAt);
      clean.push({
        url: normalized,
        ...(publishedAt ? { publishedAt } : {}),
      });
    }
  }

  return clean;
}

function collectRssEntryCandidates(xml: string): RssEntry[] {
  const entries: RssEntry[] = [];
  for (const match of xml.matchAll(RSS_ITEM_BLOCK_RE)) {
    const block = match[1] ?? "";
    const publishedAt = firstTagText(block, "pubDate")
      ?? firstTagText(block, "published")
      ?? firstTagText(block, "updated")
      ?? firstTagText(block, "dc:date");
    for (const candidate of collectRssUrlCandidates(block)) {
      entries.push({ url: candidate, ...(publishedAt ? { publishedAt } : {}) });
    }
  }
  return entries.length > 0
    ? entries
    : collectRssUrlCandidates(xml).map((url) => ({ url }));
}

function firstTagText(xml: string, tagName: string): string | null {
  const escaped = tagName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = xml.match(new RegExp(`<${escaped}\\b[^>]*>\\s*([^<]+?)\\s*</${escaped}>`, "i"));
  return match?.[1]?.trim() ?? null;
}

function normalizeRssDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : undefined;
}
