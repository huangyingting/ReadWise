/**
 * Scraper tuning configuration (server-only).
 *
 * IMPORTANT: never import from a Client Component.
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

/** Maximum body bytes the scraper will read before aborting (SCRAPER_MAX_BYTES, default 5MiB). */
export function scraperMaxBytes(): number {
  return readPositiveInt(process.env.SCRAPER_MAX_BYTES, DEFAULT_MAX_BYTES, MIN_MAX_BYTES);
}

/** Hard request timeout in ms covering connect + body read (SCRAPER_TIMEOUT_MS, default 15000). */
export function scraperTimeoutMs(): number {
  return readPositiveInt(process.env.SCRAPER_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, MIN_TIMEOUT_MS);
}

/** Whether the optional HTML normalization pass is enabled (SCRAPER_HTML_NORMALIZE=true). */
export function scraperHtmlNormalize(): boolean {
  return process.env.SCRAPER_HTML_NORMALIZE === "true";
}

/**
 * Whether the Readability-based clean-capture body extractor is enabled
 * (`SCRAPER_READABILITY`, default ON).
 *
 * Kill-switch for the linkedom + @mozilla/readability body pipeline. Unlike
 * `SCRAPER_HTML_NORMALIZE` (opt-in), this defaults to TRUE; set
 * `SCRAPER_READABILITY=false` to fall back to the legacy `<p>`-harvest body
 * (the declutter pass still runs in that fallback path).
 */
export function scraperReadability(): boolean {
  return process.env.SCRAPER_READABILITY !== "false";
}
