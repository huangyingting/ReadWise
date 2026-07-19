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
 * Default propagation grace window (6h). A newly-discovered candidate that a
 * feed announced before its CDN/origin propagated is retried within this window;
 * a 404 after it elapses is treated as a persistent not-found (quarantine).
 */
const DEFAULT_INGEST_PROPAGATION_GRACE_MS = 6 * 60 * 60 * 1000;
/** Default bounded budget of candidates reactivated per extractor-version upgrade. */
const DEFAULT_REACTIVATION_BUDGET = 50;

/** Default same-strategy retries for scraper HTTP 429 rate limits. */
const DEFAULT_FETCH_429_RETRIES = 3;
/** Default base delay in ms for scraper HTTP 429 retry backoff. */
const DEFAULT_FETCH_429_BASE_MS = 1_000;
/** Default max delay in ms for scraper HTTP 429 retry backoff. */
const DEFAULT_FETCH_429_MAX_MS = 20_000;

type EnvName =
  | "SCRAPER_MAX_BYTES"
  | "SCRAPER_TIMEOUT_MS"
  | "SCRAPER_HTML_NORMALIZE"
  | "SCRAPER_READABILITY"
  | "SCRAPER_FETCH_PROFILE_RETRY"
  | "SCRAPER_FETCH_BROWSER"
  | "SCRAPER_FETCH_READER"
  | "SCRAPER_FETCH_WAYBACK"
  | "SCRAPER_FETCH_429_RETRIES"
  | "SCRAPER_FETCH_429_BASE_MS"
  | "SCRAPER_FETCH_429_MAX_MS"
  | "SCRAPER_INGEST_PROPAGATION_GRACE_MS"
  | "SCRAPER_REACTIVATION_BUDGET"
  | "SCRAPER_QUALITY_CLASSIFIER";

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

/**
 * Parses `raw` as a non-negative integer, falling back to `fallback` when it is
 * missing, non-numeric, or below `min`. Use this for knobs where 0 disables work.
 */
function readNonNegativeInt(raw: string | undefined, fallback: number, min: number): number {
  return readPositiveInt(raw, fallback, Math.max(0, min));
}

function readEnvInt(name: EnvName, fallback: number, min: number): number {
  return readPositiveInt(process.env[name], fallback, min);
}

function readEnvNonNegativeInt(name: EnvName, fallback: number, min: number): number {
  return readNonNegativeInt(process.env[name], fallback, min);
}

function isEnvEnabledByDefault(name: EnvName): boolean {
  return process.env[name] !== "false";
}

/** Maximum body bytes the scraper will read before aborting (SCRAPER_MAX_BYTES, default 5MiB). */
export function scraperMaxBytes(): number {
  return readEnvInt("SCRAPER_MAX_BYTES", DEFAULT_MAX_BYTES, MIN_MAX_BYTES);
}

/** Hard request timeout in ms covering connect + body read (SCRAPER_TIMEOUT_MS, default 15000). */
export function scraperTimeoutMs(): number {
  return readEnvInt("SCRAPER_TIMEOUT_MS", DEFAULT_TIMEOUT_MS, MIN_TIMEOUT_MS);
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
  return isEnvEnabledByDefault("SCRAPER_READABILITY");
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
  return isEnvEnabledByDefault("SCRAPER_FETCH_PROFILE_RETRY");
}

/**
 * Whether the headless-browser fetch stage is enabled
 * (`SCRAPER_FETCH_BROWSER`, default ON).
 *
 * When ON, pages that stay bot-challenged after profile retries are rendered
 * directly via headless Chromium before falling back to the reader proxy. This
 * can solve JS/Cloudflare challenges; if Playwright is not installed or launch
 * fails, the strategy gracefully degrades to the reader/Wayback stages.
 */
export function scraperFetchBrowser(): boolean {
  return isEnvEnabledByDefault("SCRAPER_FETCH_BROWSER");
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
  return isEnvEnabledByDefault("SCRAPER_FETCH_READER");
}

/**
 * Whether the Wayback Machine snapshot fallback is enabled
 * (`SCRAPER_FETCH_WAYBACK`, default ON).
 *
 * Last-resort fallback that fetches the original (toolbar-free) archived HTML
 * via `https://web.archive.org/web/<YYYY>id_/<url>`. Set to `false` to skip it.
 */
export function scraperFetchWayback(): boolean {
  return isEnvEnabledByDefault("SCRAPER_FETCH_WAYBACK");
}

/**
 * Max same-strategy retries after HTTP 429 rate limits
 * (`SCRAPER_FETCH_429_RETRIES`, default 3).
 *
 * Set to `0` to disable retrying 429s before the fallback chain advances.
 */
export function scraperFetch429Retries(): number {
  return readEnvNonNegativeInt("SCRAPER_FETCH_429_RETRIES", DEFAULT_FETCH_429_RETRIES, 0);
}

/**
 * Base delay in ms for HTTP 429 same-strategy retry backoff
 * (`SCRAPER_FETCH_429_BASE_MS`, default 1000).
 *
 * Set to `0` to disable waiting/retrying 429s before the fallback chain advances.
 */
export function scraperFetch429BaseMs(): number {
  return readEnvNonNegativeInt("SCRAPER_FETCH_429_BASE_MS", DEFAULT_FETCH_429_BASE_MS, 0);
}

/**
 * Max delay in ms for HTTP 429 same-strategy retry backoff
 * (`SCRAPER_FETCH_429_MAX_MS`, default 20000).
 *
 * Set to `0` to disable waiting/retrying 429s before the fallback chain advances.
 */
export function scraperFetch429MaxMs(): number {
  return readEnvNonNegativeInt("SCRAPER_FETCH_429_MAX_MS", DEFAULT_FETCH_429_MAX_MS, 0);
}

/**
 * Whether the local Naive-Bayes ad/article quality classifier is enabled
 * (`SCRAPER_QUALITY_CLASSIFIER`, default ON).
 *
 * When ON, {@link checkContentQuality} runs the committed `natural`
 * Naive-Bayes model as ONE additional, conservative quality signal that
 * complements (never replaces) the heuristic checks. Set to `false` to skip
 * the classifier entirely (no model is loaded). The heuristics remain primary.
 */
export function scraperQualityClassifier(): boolean {
  return isEnvEnabledByDefault("SCRAPER_QUALITY_CLASSIFIER");
}

/**
 * Propagation grace window in ms for candidate-based ingestion
 * (`SCRAPER_INGEST_PROPAGATION_GRACE_MS`, default 6h; #1093).
 *
 * A newly-discovered candidate is retried within this window from its first
 * ingest attempt so a feed item announced before its origin/CDN propagated can
 * still be ingested WITHOUT rediscovery. A `404` inside the window is treated as
 * pre-propagation (retry); a `404` after it elapses is a persistent not-found
 * that quarantines. Set to `0` to disable the grace window (a `404` quarantines
 * on exhaustion of the ordinary retry budget).
 */
export function scraperIngestPropagationGraceMs(): number {
  return readEnvNonNegativeInt(
    "SCRAPER_INGEST_PROPAGATION_GRACE_MS",
    DEFAULT_INGEST_PROPAGATION_GRACE_MS,
    0,
  );
}

/**
 * Bounded per-upgrade reactivation budget (`SCRAPER_REACTIVATION_BUDGET`,
 * default 50; #1093).
 *
 * Caps how many quarantined no-Article extraction/quality failures an extractor-
 * version upgrade may reactivate in one pass, so a version bump can never stampede
 * the whole quarantine backlog. Set to `0` to disable reactivation entirely.
 */
export function scraperReactivationBudget(): number {
  return readEnvNonNegativeInt("SCRAPER_REACTIVATION_BUDGET", DEFAULT_REACTIVATION_BUDGET, 0);
}
