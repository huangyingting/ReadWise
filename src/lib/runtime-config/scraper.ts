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

/**
 * Bounded historical-backfill defaults (#1101, Phase 3.2). These clamp an
 * administrator-approved backfill so an approval can never turn into an
 * unbounded archive crawl: the requested item count and window span are clamped
 * to these ceilings, and the driver reactivates at most `BATCH_SIZE` matching
 * identities per tick (each enqueued at the LOW backfill job priority so
 * real-time incremental work is never starved). Nothing here reads a clock or DB.
 */
/** Default hard ceiling on the number of identities ONE backfill may reactivate. */
const DEFAULT_BACKFILL_MAX_ITEMS_CEILING = 5_000;
/** Default hard ceiling on the requested window span (days) ONE backfill may cover. */
const DEFAULT_BACKFILL_MAX_WINDOW_DAYS = 3_660;
/** Default matching identities reactivated per backfill driver tick (paced batch). */
const DEFAULT_BACKFILL_BATCH_SIZE = 50;

/**
 * Rate-governor defaults (#1094, Phase 2.4). Every knob is individually
 * overridable and, where the reading is natural, `0` means "disabled/unlimited"
 * (documented per accessor). These feed the PURE governor in
 * `src/lib/scraper/incremental/rate-governor.ts`; nothing here reads a clock or DB.
 */
/** Default max simultaneous in-flight requests (discovery + body) to one hostname. */
const DEFAULT_HOST_CONCURRENCY = 2;
/** Default minimum interval (ms) between two requests to the same hostname. */
const DEFAULT_HOST_MIN_INTERVAL_MS = 1_000;
/** Default per-hostname per-UTC-day request ceiling (discovery + body combined). */
const DEFAULT_HOST_DAILY_CEILING = 5_000;
/** Default per-provider per-UTC-day request quota. */
const DEFAULT_PROVIDER_DAILY_QUOTA = 10_000;
/** Default per-UTC-day discovery-request (RSS/sitemap) budget. */
const DEFAULT_DISCOVERY_DAILY_BUDGET = 20_000;
/** Default per-UTC-day article-body-fetch budget. */
const DEFAULT_BODY_DAILY_BUDGET = 5_000;
/** Default per-UTC-day AI/narration budget. */
const DEFAULT_AI_DAILY_BUDGET = 2_000;
/** Default hostname-concurrency slots reserved for real-time incremental work. */
const DEFAULT_INCREMENTAL_RESERVED_SLOTS = 1;
/** Default candidate-backlog capacity threshold that triggers low-priority throttling. */
const DEFAULT_BACKLOG_CAPACITY_THRESHOLD = 10_000;
/** Default consecutive 429/403/5xx responses before a hostname is auto-paused. */
const DEFAULT_HOST_ERROR_PAUSE_THRESHOLD = 3;
/** Default base auto-pause duration (ms) once the error threshold is crossed. */
const DEFAULT_HOST_PAUSE_BASE_MS = 60_000;
/** Default maximum auto-pause duration (ms). */
const DEFAULT_HOST_PAUSE_MAX_MS = 60 * 60_000;

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
  | "SCRAPER_BACKFILL_MAX_ITEMS_CEILING"
  | "SCRAPER_BACKFILL_MAX_WINDOW_DAYS"
  | "SCRAPER_BACKFILL_BATCH_SIZE"
  | "SCRAPER_FORCE_RESCRAPE"
  | "SCRAPER_HOST_CONCURRENCY"
  | "SCRAPER_HOST_MIN_INTERVAL_MS"
  | "SCRAPER_HOST_DAILY_CEILING"
  | "SCRAPER_PROVIDER_DAILY_QUOTA"
  | "SCRAPER_DISCOVERY_DAILY_BUDGET"
  | "SCRAPER_BODY_DAILY_BUDGET"
  | "SCRAPER_AI_DAILY_BUDGET"
  | "SCRAPER_INCREMENTAL_RESERVED_SLOTS"
  | "SCRAPER_BACKLOG_CAPACITY_THRESHOLD"
  | "SCRAPER_HOST_ERROR_PAUSE_THRESHOLD"
  | "SCRAPER_HOST_PAUSE_BASE_MS"
  | "SCRAPER_HOST_PAUSE_MAX_MS"
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

/**
 * Hard ceiling on the number of historical identities ONE administrator-approved
 * backfill may reactivate (`SCRAPER_BACKFILL_MAX_ITEMS_CEILING`, default 5000;
 * #1101). A larger requested max is clamped DOWN to this (with a warning); the
 * approved effective bound is what the run enforces, so an approval can never
 * become an unbounded archive crawl. Minimum 1.
 */
export function scraperBackfillMaxItemsCeiling(): number {
  return readEnvInt("SCRAPER_BACKFILL_MAX_ITEMS_CEILING", DEFAULT_BACKFILL_MAX_ITEMS_CEILING, 1);
}

/**
 * Hard ceiling on the requested window SPAN in days ONE backfill may cover
 * (`SCRAPER_BACKFILL_MAX_WINDOW_DAYS`, default 3660 ≈ 10y; #1101). A wider
 * requested window is clamped by moving the START forward (keeping the requested
 * END), with a warning. Minimum 1.
 */
export function scraperBackfillMaxWindowDays(): number {
  return readEnvInt("SCRAPER_BACKFILL_MAX_WINDOW_DAYS", DEFAULT_BACKFILL_MAX_WINDOW_DAYS, 1);
}

/**
 * Matching identities reactivated per backfill driver tick
 * (`SCRAPER_BACKFILL_BATCH_SIZE`, default 50; #1101). Each tick reactivates at
 * most this many candidates (transition + low-priority ingest enqueue) and
 * advances the durable checkpoint, so a large run is paced and stays resumable.
 * Minimum 1.
 */
export function scraperBackfillBatchSize(): number {
  return readEnvInt("SCRAPER_BACKFILL_BATCH_SIZE", DEFAULT_BACKFILL_BATCH_SIZE, 1);
}

/**
 * Whether the audited, operator-only force-rescrape of a KNOWN public Article is
 * enabled (`SCRAPER_FORCE_RESCRAPE`, default ON; #1102). This is a KILL-SWITCH,
 * not the authorization gate: the dedicated endpoint is ALWAYS capability-gated
 * (`sources.manage`) and requires a mandatory reason. When set to `false` the
 * endpoint fails closed BEFORE any read/write — no content version is created —
 * so an operator can hard-disable known-Article refresh without touching RBAC.
 * force-rescrape remains unreachable from scheduled/normal discovery either way
 * (governing invariant); this flag only governs the dedicated manual path.
 */
export function scraperForceRescrapeEnabled(): boolean {
  return isEnvEnabledByDefault("SCRAPER_FORCE_RESCRAPE");
}

/**
 * Max simultaneous in-flight requests (discovery RSS/sitemap + article body,
 * shared) to ONE hostname (`SCRAPER_HOST_CONCURRENCY`, default 2; #1094).
 *
 * Set to `0` for UNLIMITED concurrency (no per-hostname cap).
 */
export function scraperHostConcurrency(): number {
  return readEnvNonNegativeInt("SCRAPER_HOST_CONCURRENCY", DEFAULT_HOST_CONCURRENCY, 0);
}

/**
 * Minimum interval (ms) between two requests to the same hostname
 * (`SCRAPER_HOST_MIN_INTERVAL_MS`, default 1000; #1094).
 *
 * Set to `0` to DISABLE the min-interval throttle.
 */
export function scraperHostMinIntervalMs(): number {
  return readEnvNonNegativeInt("SCRAPER_HOST_MIN_INTERVAL_MS", DEFAULT_HOST_MIN_INTERVAL_MS, 0);
}

/**
 * Per-hostname per-UTC-day request ceiling, discovery + body combined
 * (`SCRAPER_HOST_DAILY_CEILING`, default 5000; #1094).
 *
 * Set to `0` for an UNLIMITED daily ceiling.
 */
export function scraperHostDailyCeiling(): number {
  return readEnvNonNegativeInt("SCRAPER_HOST_DAILY_CEILING", DEFAULT_HOST_DAILY_CEILING, 0);
}

/**
 * Per-provider per-UTC-day request quota (`SCRAPER_PROVIDER_DAILY_QUOTA`,
 * default 10000; #1094).
 *
 * Set to `0` for an UNLIMITED per-provider quota.
 */
export function scraperProviderDailyQuota(): number {
  return readEnvNonNegativeInt("SCRAPER_PROVIDER_DAILY_QUOTA", DEFAULT_PROVIDER_DAILY_QUOTA, 0);
}

/**
 * Per-UTC-day discovery-request (RSS/sitemap) budget
 * (`SCRAPER_DISCOVERY_DAILY_BUDGET`, default 20000; #1094).
 *
 * Set to `0` for an UNLIMITED discovery budget. Discovery is the cheap work
 * that stays alive even when the body/AI budgets are exhausted.
 */
export function scraperDiscoveryDailyBudget(): number {
  return readEnvNonNegativeInt("SCRAPER_DISCOVERY_DAILY_BUDGET", DEFAULT_DISCOVERY_DAILY_BUDGET, 0);
}

/**
 * Per-UTC-day article-body-fetch budget (`SCRAPER_BODY_DAILY_BUDGET`,
 * default 5000; #1094).
 *
 * Set to `0` for an UNLIMITED body-fetch budget. When exhausted, body/downstream
 * work is DEFERRED while low-cost discovery + candidate persistence keep running.
 */
export function scraperBodyDailyBudget(): number {
  return readEnvNonNegativeInt("SCRAPER_BODY_DAILY_BUDGET", DEFAULT_BODY_DAILY_BUDGET, 0);
}

/**
 * Per-UTC-day AI/narration budget (`SCRAPER_AI_DAILY_BUDGET`, default 2000; #1094).
 *
 * Set to `0` for an UNLIMITED AI/narration budget. Exhausting it NEVER stops
 * discovery (explicit non-goal); only the AI/narration downstream is deferred.
 */
export function scraperAiDailyBudget(): number {
  return readEnvNonNegativeInt("SCRAPER_AI_DAILY_BUDGET", DEFAULT_AI_DAILY_BUDGET, 0);
}

/**
 * Hostname-concurrency slots RESERVED for real-time incremental work so future
 * backfill can never starve new-article ingestion
 * (`SCRAPER_INCREMENTAL_RESERVED_SLOTS`, default 1; #1094).
 *
 * Set to `0` to DISABLE reservation (backfill may use the full concurrency).
 * Clamped to the hostname concurrency by the pure governor.
 */
export function scraperIncrementalReservedSlots(): number {
  return readEnvNonNegativeInt(
    "SCRAPER_INCREMENTAL_RESERVED_SLOTS",
    DEFAULT_INCREMENTAL_RESERVED_SLOTS,
    0,
  );
}

/**
 * Candidate-backlog capacity threshold (`SCRAPER_BACKLOG_CAPACITY_THRESHOLD`,
 * default 10000; #1094).
 *
 * When the pending candidate backlog approaches this size the governor throttles
 * low-priority source frequency and raises an alert signal; candidates are NEVER
 * deleted or silently dropped. Set to `0` to DISABLE backlog throttling.
 */
export function scraperBacklogCapacityThreshold(): number {
  return readEnvNonNegativeInt(
    "SCRAPER_BACKLOG_CAPACITY_THRESHOLD",
    DEFAULT_BACKLOG_CAPACITY_THRESHOLD,
    0,
  );
}

/**
 * Consecutive 429/403/5xx responses from one hostname before it is auto-paused
 * (`SCRAPER_HOST_ERROR_PAUSE_THRESHOLD`, default 3; #1094).
 *
 * A server `Retry-After` pauses immediately regardless of this count. Set to `0`
 * to DISABLE threshold-based auto-pause (only `Retry-After` then pauses).
 */
export function scraperHostErrorPauseThreshold(): number {
  return readEnvNonNegativeInt(
    "SCRAPER_HOST_ERROR_PAUSE_THRESHOLD",
    DEFAULT_HOST_ERROR_PAUSE_THRESHOLD,
    0,
  );
}

/**
 * Base auto-pause duration (ms) applied once a hostname crosses the error
 * threshold (`SCRAPER_HOST_PAUSE_BASE_MS`, default 60000; #1094). The pause grows
 * exponentially with each extra error, capped at {@link scraperHostPauseMaxMs}.
 */
export function scraperHostPauseBaseMs(): number {
  return readEnvNonNegativeInt("SCRAPER_HOST_PAUSE_BASE_MS", DEFAULT_HOST_PAUSE_BASE_MS, 0);
}

/**
 * Maximum auto-pause duration (ms) for a backed-off hostname
 * (`SCRAPER_HOST_PAUSE_MAX_MS`, default 3600000; #1094).
 */
export function scraperHostPauseMaxMs(): number {
  return readEnvNonNegativeInt("SCRAPER_HOST_PAUSE_MAX_MS", DEFAULT_HOST_PAUSE_MAX_MS, 0);
}
