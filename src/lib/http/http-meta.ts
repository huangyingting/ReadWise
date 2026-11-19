/** Small response/URL helpers shared by the provider client and the scraper fetcher. */

/**
 * Parses a `Retry-After` header value (seconds or HTTP-date) into ms.
 * Returns null when the header is absent or unparseable.
 */
export function parseRetryAfterMs(header: string | null): number | null {
  if (!header) return null;
  const seconds = parseFloat(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const date = Date.parse(header);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  return null;
}

/** The URL's hostname for span/metric attributes; "unknown" rather than a raw or invalid URL. */
export function telemetryHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "unknown";
  }
}
