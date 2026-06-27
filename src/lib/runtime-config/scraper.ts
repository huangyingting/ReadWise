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

/**
 * Whether the browser-profile retry stage of the multi-strategy fetch fallback
 * chain is enabled (`SCRAPER_FETCH_PROFILE_RETRY`, default ON).
 *
 * When ON, a bot-challenged origin (401/403/429/451/503) is retried with a
 * rotation of realistic browser/bot User-Agent + header profiles before falling
 * back to the reader/Wayback stages. Set to `false` to do only the single
 * origin attempt.
 */
export function scraperFetchProfileRetry(): boolean {
  return process.env.SCRAPER_FETCH_PROFILE_RETRY !== "false";
}

/**
 * Whether the r.jina.ai reader-proxy fallback is enabled
 * (`SCRAPER_FETCH_READER`, default ON).
 *
 * When a page stays bot-challenged after profile retries, the reader proxy
 * (`https://r.jina.ai/<url>`) is tried with `X-Return-Format: html` (and a
 * `Bearer` token when `JINA_API_KEY` is set). Set to `false` to skip it.
 */
export function scraperFetchReader(): boolean {
  return process.env.SCRAPER_FETCH_READER !== "false";
}

/**
 * Whether the Wayback Machine snapshot fallback is enabled
 * (`SCRAPER_FETCH_WAYBACK`, default ON).
 *
 * Last-resort fallback that fetches the original (toolbar-free) archived HTML
 * via `https://web.archive.org/web/<YYYY>id_/<url>`. Set to `false` to skip it.
 */
export function scraperFetchWayback(): boolean {
  return process.env.SCRAPER_FETCH_WAYBACK !== "false";
}
