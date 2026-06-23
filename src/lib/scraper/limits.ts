/**
 * Network limits for the scraper's outbound HTTP fetches (SSRF hardening).
 *
 * Both limits are read from the environment on each call (with safe defaults
 * and floors) so they can be tuned per-deployment without a redeploy and so
 * tests can override them. Kept scraper-local — these knobs are specific to the
 * remote-fetch attack surface and intentionally NOT part of the global config.
 */

/** Default body cap (5 MiB). Articles are tiny; this guards against zip-bomb / huge bodies. */
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
/** Don't allow a body cap so small it can't hold a real article. */
const MIN_MAX_BYTES = 256;

/** Default hard request budget across connect + redirects + body read. */
const DEFAULT_TIMEOUT_MS = 15_000;
/** Don't allow a timeout so short that no real request could complete. */
const MIN_TIMEOUT_MS = 10;

/**
 * Parses `raw` as a positive integer, falling back to `fallback` when it is
 * missing, non-numeric, or below `min`.
 */
function readPositiveInt(raw: string | undefined, fallback: number, min: number): number {
  if (raw === undefined || raw === null || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min) return fallback;
  return Math.floor(n);
}

/** Maximum number of body bytes the scraper will read before aborting (env `SCRAPER_MAX_BYTES`). */
export function scraperMaxBytes(): number {
  return readPositiveInt(process.env.SCRAPER_MAX_BYTES, DEFAULT_MAX_BYTES, MIN_MAX_BYTES);
}

/** Hard request timeout in milliseconds covering connect + body read (env `SCRAPER_TIMEOUT_MS`). */
export function scraperTimeoutMs(): number {
  return readPositiveInt(process.env.SCRAPER_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, MIN_TIMEOUT_MS);
}
