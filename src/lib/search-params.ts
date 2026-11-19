/**
 * URL search-param parsing helpers for pages that read untrusted `?page=` /
 * `?limit=` / `?offset=` values.
 *
 * @boundary pure — no DOM, no `node:*`, no server-only APIs.
 */

/**
 * Parses an integer search param and clamps it into `[min, max]`. Missing or
 * non-numeric values return `fallback`.
 */
export function parseBoundedInt(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const n = Number.parseInt(raw ?? "", 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

/** Parses a 1-based `?page=` param; anything missing or below 1 is page 1. */
export function parsePageParam(raw: string | undefined): number {
  return parseBoundedInt(raw, 1, 1, Number.MAX_SAFE_INTEGER);
}
