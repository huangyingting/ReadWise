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
export function parseRssUrls(xml: string): string[] {
  const raw: string[] = [];

  // RSS 2.0: <link>https://…</link>  (text node, not an attribute)
  for (const m of xml.matchAll(/<link>\s*([^\s<]+)\s*<\/link>/gi)) {
    raw.push(m[1]);
  }

  // <guid> or <guid isPermaLink="true"> — treat as URL unless isPermaLink="false"
  for (const m of xml.matchAll(/<guid(\s[^>]*)?>([^<]+)<\/guid>/gi)) {
    const attrs = m[1] ?? "";
    const isExplicitlyNotPermalink = /isPermaLink\s*=\s*["']false["']/i.test(attrs);
    if (!isExplicitlyNotPermalink) {
      raw.push(m[2].trim());
    }
  }

  const seen = new Set<string>();
  const clean: string[] = [];

  for (const candidate of raw) {
    const trimmed = candidate.trim();
    if (!trimmed.startsWith("http")) continue;
    try {
      const u = new URL(trimmed);
      u.search = "";
      u.hash = "";
      const normalized = u.href;
      if (!seen.has(normalized)) {
        seen.add(normalized);
        clean.push(normalized);
      }
    } catch {
      // skip unparseable entries
    }
  }

  return clean;
}
