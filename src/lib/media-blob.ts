/**
 * Media blob helpers (REF-030) — pure utilities for converting base64 /
 * data-URI encoded audio into a Blob URL (CSP-safe) and for revoking Blob
 * URLs on cleanup.
 *
 * Client-safe: no server imports, no React.
 */

/**
 * Convert a base64 string or data-URI to a Blob URL.
 *
 * Data-URIs (e.g. `data:audio/mpeg;base64,AAA…`) are accepted; the header is
 * stripped and only the base64 payload is decoded.  The returned URL MUST be
 * revoked with {@link revokeBlobUrl} when no longer needed to avoid memory
 * leaks.
 */
export function base64ToBlobUrl(base64OrDataUri: string, mimeType: string): string {
  const base64 = base64OrDataUri.includes(",")
    ? base64OrDataUri.split(",")[1]
    : base64OrDataUri;
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const blob = new Blob([bytes], { type: mimeType });
  return URL.createObjectURL(blob);
}

/**
 * Revoke a Blob URL, freeing the associated memory.
 * Safe to call with `null` or `undefined` — the call is a no-op in those cases.
 */
export function revokeBlobUrl(url: string | null | undefined): void {
  if (url) URL.revokeObjectURL(url);
}
