/**
 * Lightweight RSS 2.0 / Atom feed URL extractor for provider discovery.
 *
 * Intentionally regex-based (no XML-parser dependency) — feeds are
 * well-structured enough that a targeted approach works reliably and keeps
 * the bundle small. Only URLs are extracted; all other fields are ignored.
 */

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
  const seen = new Set<string>();
  const clean: string[] = [];

  for (const candidate of collectRssUrlCandidates(xml)) {
    const normalized = normalizeRssUrlCandidate(candidate);
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      clean.push(normalized);
    }
  }

  return clean;
}
