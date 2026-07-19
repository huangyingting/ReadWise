/**
 * Pure, dependency-free URL redaction for scraper logs and error messages.
 *
 * Extracted from `url-identity.ts` so the SSRF-safe fetch layer (`fetch.ts`) can
 * redact URLs WITHOUT transitively importing the provider registry. It is the
 * single source of truth for {@link redactUrlForLog}; `url-identity.ts` re-exports
 * it to preserve its public surface.
 *
 * Contract: no network, no database, no provider lookups — just a URL -> safe
 * string transform.
 */

/**
 * Renders any URL as a secret-free string safe for logs and error messages:
 * userinfo, the entire query string, and the fragment are removed. Returns a
 * fixed placeholder when the input cannot be parsed (so a malformed,
 * credential-bearing string is never echoed verbatim).
 */
export function redactUrlForLog(rawUrl: string): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return "[unparseable-url]";
  }
  url.username = "";
  url.password = "";
  url.hash = "";
  const query = url.search.length > 0 ? "?[redacted]" : "";
  return `${url.protocol}//${url.host}${url.pathname}${query}`;
}
