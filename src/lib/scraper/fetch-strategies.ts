/**
 * Multi-strategy HTTP fetch fallback chain for the scraper's `fetchHtml` (GET).
 *
 * Bot-protection layers (Cloudflare / DataDome) increasingly answer a plain
 * crawler request with a challenge status (401/403/429/451/503) even when a
 * realistic desktop User-Agent is used. This module layers a fallback chain on
 * top of the SSRF-safe core fetch so those pages can still be captured:
 *
 *   1. origin            — the existing default request (unchanged behavior).
 *   2. browser profiles  — retry with rotating realistic UA + header sets.
 *   3. browser render    — headless Chromium for JS/Cloudflare challenges.
 *   4. reader proxy      — `https://r.jina.ai/<url>` (cleaned HTML).
 *   5. Wayback snapshot  — `https://web.archive.org/web/<YYYY>id_/<url>`.
 *
 * Each strategy also retries HTTP 429 from the SAME target a few times with
 * jittered exponential backoff, honoring `Retry-After`, before the chain
 * advances to the next strategy.
 *
 * Only a *bot-challenge* status advances the chain; a genuine not-found
 * (404/410) — or any SSRF/timeout/network error — aborts immediately and
 * bubbles up unchanged. Modern bot protection (Cloudflare / Vercel / DataDome)
 * also answers with an HTTP 200 carrying an interstitial challenge page rather
 * than a challenge status; `looksLikeBotChallenge` detects those by content so
 * a 200-challenge is treated as BLOCKED and the chain escalates too. If the
 * whole chain only ever yields challenge pages, a `BotChallengeError` is thrown
 * so extraction never receives a challenge interstitial. A per-host,
 * process-lifetime memory records the winning strategy so subsequent fetches of
 * the same host try it first and skip the slow chain.
 *
 * ## Security
 *
 * - The original URL is SSRF-validated (`assertSafeUrl`) BEFORE any request, so
 *   reader/Wayback URLs are only ever built from an already-validated public
 *   origin URL (never an internal/private one). The origin/profile requests go
 *   through `fetchCore`, which re-validates and IP-pins every redirect hop.
 * - The reader/Wayback requests target FIXED trusted public hosts
 *   (`r.jina.ai`, `web.archive.org`); the constructed proxy URL's host is
 *   asserted against that allowlist before fetching.
 * - robots posture is unchanged: robots is enforced at discovery via
 *   `isUrlAllowed`; this layer adds no robots bypass.
 *
 * @server-only — depends on the Node/undici core fetch; never import from a
 * "use client" file.
 */
import { fetchCore, FetchHttpError } from "@/lib/scraper/fetch";
import { renderViaBrowser } from "@/lib/scraper/fetch-browser";
import { assertSafeUrl } from "@/lib/scraper/ssrf";
import { scraperTimeoutMs } from "@/lib/scraper/limits";
import {
  scraperFetch429BaseMs,
  scraperFetch429MaxMs,
  scraperFetch429Retries,
  scraperFetchBrowser,
  scraperFetchProfileRetry,
  scraperFetchReader,
  scraperFetchWayback,
} from "@/lib/runtime-config/scraper";
import { createLogger } from "@/lib/observability/logger";
import { jitteredExponentialBackoff } from "@/lib/backoff";

const log = createLogger("scraper.fetch-strategies");

/** Statuses that indicate a bot challenge worth retrying with another strategy. */
const BOT_CHALLENGE_STATUSES = new Set([401, 403, 429, 451, 503]);

/**
 * Named vendor markers that uniquely identify a bot-protection interstitial
 * (Cloudflare / Vercel / DataDome / PerimeterX / Akamai). These are returned
 * even with an HTTP 200 status, so a status check alone never catches them.
 * All matched case-insensitively against the raw HTML body.
 */
const CHALLENGE_VENDOR_MARKERS: readonly string[] = [
  // Cloudflare
  "just a moment...",
  "attention required! | cloudflare",
  "checking your browser before accessing",
  "cf-browser-verification",
  "cf-challenge",
  "performing security verification",
  "enable javascript and cookies to continue",
  "__cf_chl",
  // Vercel
  "vercel security checkpoint",
  "we're verifying your browser",
  // DataDome / PerimeterX / Akamai
  "datadome",
  "px-captcha",
  "access to this page has been denied",
  "pardon our interruption",
];

/**
 * A "tiny" rendered body (in visible-text characters) below which a page with a
 * `noindex,nofollow` robots meta and no article markers is treated as a
 * challenge. Real articles, even short ones, comfortably exceed this.
 */
const TINY_BODY_TEXT_CHARS = 250;

/** Strips tags/scripts/styles and collapses whitespace to estimate visible text length. */
function visibleTextLength(html: string): number {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length;
}

/** Counts `<p ...>`/`<p>` opening tags as a cheap proxy for article paragraphs. */
function paragraphCount(html: string): number {
  const matches = html.match(/<p[\s>]/gi);
  return matches ? matches.length : 0;
}

/** True when the HTML carries strong signals of a real article (suppresses false positives). */
function hasArticleMarkers(html: string): boolean {
  const lower = html.toLowerCase();
  if (lower.includes("<article")) return true;
  if (paragraphCount(html) >= 3) return true;
  if (lower.includes('application/ld+json')) return true;
  if (lower.includes('property="og:title"') || lower.includes("property='og:title'")) return true;
  return false;
}

/** True when the HTML declares a `noindex` robots meta (common on challenge pages). */
function hasNoindexMeta(html: string): boolean {
  return /<meta[^>]+name=["']robots["'][^>]+content=["'][^"']*noindex/i.test(html);
}

/**
 * Heuristically detects a modern bot-protection interstitial that is returned
 * with an HTTP 200 (Cloudflare "Just a moment...", Vercel "Security Checkpoint",
 * DataDome, etc.) so the fetch chain can treat it as BLOCKED and escalate.
 *
 * Conservative by design — a real (even short) article must NOT be flagged:
 *  - If the body has an `<article>`, ≥3 `<p>`, JSON-LD, or an og:title, it is
 *    treated as real content and is never a challenge.
 *  - Otherwise it is a challenge when EITHER a named vendor marker is present,
 *    OR the body is tiny (visible text < ~250 chars) with a `noindex` robots
 *    meta and no article markers.
 *
 * @param html   The raw response body.
 * @param status Optional HTTP status (already-blocked statuses short-circuit true).
 */
export function looksLikeBotChallenge(html: string, status?: number): boolean {
  if (typeof status === "number" && BOT_CHALLENGE_STATUSES.has(status)) {
    return true;
  }
  if (!html || typeof html !== "string") return false;

  // Strong guard: anything that looks like a real article is never a challenge,
  // even if a vendor string happens to appear in its prose.
  if (hasArticleMarkers(html)) return false;

  const lower = html.toLowerCase();
  for (const marker of CHALLENGE_VENDOR_MARKERS) {
    if (lower.includes(marker)) return true;
  }

  // Generic tiny-interstitial heuristic: very short body + noindex + no article.
  if (hasNoindexMeta(html) && visibleTextLength(html) < TINY_BODY_TEXT_CHARS) {
    return true;
  }

  return false;
}

/** Error thrown when the whole chain only ever yielded bot-challenge pages. */
export class BotChallengeError extends Error {
  readonly host: string;
  constructor(host: string) {
    super(`bot challenge not bypassed for ${host}`);
    this.name = "BotChallengeError";
    this.host = host;
  }
}

/** Statuses that are genuine not-found and must NOT trigger any fallback. */
const NOT_FOUND_STATUSES = new Set([404, 410]);

/** The only hosts the reader/Wayback fallbacks are ever allowed to contact. */
const ALLOWED_FALLBACK_HOSTS = new Set(["r.jina.ai", "web.archive.org"]);

/** Overall budget multiplier over the per-attempt timeout, so the chain can't hang. */
const OVERALL_BUDGET_FACTOR = 4;

/** A realistic browser/bot fingerprint: a UA plus a matching header set. */
interface BrowserProfile {
  readonly name: string;
  readonly headers: Record<string, string>;
}

const DESKTOP_FETCH_HEADERS: Record<string, string> = {
  accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9",
  "sec-fetch-mode": "navigate",
  "sec-fetch-site": "none",
  "sec-fetch-dest": "document",
  "upgrade-insecure-requests": "1",
};

const SIMPLE_FETCH_HEADERS: Record<string, string> = {
  accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9",
};

/**
 * Browser/bot profiles tried on a bot-challenged origin, in order. The existing
 * Googlebot identity is kept first for backward-compat, then a rotation of
 * realistic desktop and mobile browsers, ending with Bingbot.
 */
const PROFILES: readonly BrowserProfile[] = [
  {
    name: "googlebot",
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
      ...SIMPLE_FETCH_HEADERS,
    },
  },
  {
    name: "desktop-chrome",
    headers: {
      "user-agent":
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      ...DESKTOP_FETCH_HEADERS,
    },
  },
  {
    name: "desktop-firefox",
    headers: {
      "user-agent": "Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0",
      ...DESKTOP_FETCH_HEADERS,
    },
  },
  {
    name: "desktop-safari",
    headers: {
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
      ...DESKTOP_FETCH_HEADERS,
    },
  },
  {
    name: "mobile-safari",
    headers: {
      "user-agent":
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
      ...SIMPLE_FETCH_HEADERS,
    },
  },
  {
    name: "bingbot",
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
      ...SIMPLE_FETCH_HEADERS,
    },
  },
];

/**
 * A single step in the fallback chain. `id` is a stable identifier used as the
 * per-host memory key; `run` performs one fetch attempt (or throws).
 */
interface Strategy {
  readonly id: string;
  /** True for origin/profile steps (target = the actual page), false for proxy steps. */
  readonly isOrigin: boolean;
  run(url: string, timeoutMs: number): Promise<string>;
}

type FetchHtmlWithStrategiesDeps = {
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
};

/** Per-host, process-lifetime memory of the strategy that last worked for a host. */
const hostStrategyMemory = new Map<string, string>();

function isFetchHttpError(err: unknown): err is FetchHttpError {
  return err instanceof FetchHttpError;
}

function isRateLimit(err: unknown): err is FetchHttpError {
  return isFetchHttpError(err) && err.status === 429;
}

/** A bot-challenge status (401/403/429/451/503) — advances the chain. */
function isBotChallenge(err: unknown): boolean {
  return isFetchHttpError(err) && BOT_CHALLENGE_STATUSES.has(err.status);
}

/** A genuine not-found (404/410) — must abort the chain, no fallback. */
function isGenuineNotFound(err: unknown): boolean {
  return isFetchHttpError(err) && NOT_FOUND_STATUSES.has(err.status);
}

/** Asserts a constructed proxy URL targets one of the allowlisted fallback hosts. */
function assertAllowedFallbackHost(proxyUrl: string): void {
  const host = new URL(proxyUrl).hostname;
  if (!ALLOWED_FALLBACK_HOSTS.has(host)) {
    throw new Error(`Fallback host not allowed: ${host}`);
  }
}

/** Builds the headless-browser strategy for an already-validated origin URL. */
function browserStrategy(originalUrl: string): Strategy {
  return {
    id: "browser",
    isOrigin: false,
    run: async (_url, timeoutMs) => {
      const { status, html } = await renderViaBrowser(originalUrl, timeoutMs);
      if (status === 404 || status === 410) {
        throw new FetchHttpError(status, originalUrl);
      }
      if (status === 429) {
        throw new FetchHttpError(429, originalUrl);
      }
      if (status >= 200 && status < 300) {
        return html;
      }
      throw new FetchHttpError(status || 503, originalUrl);
    },
  };
}

/** Builds the r.jina.ai reader-proxy strategy for an already-validated origin URL. */
function readerStrategy(originalUrl: string): Strategy {
  return {
    id: "reader",
    isOrigin: false,
    run: async (_url, timeoutMs) => {
      const proxyUrl = `https://r.jina.ai/${originalUrl}`;
      assertAllowedFallbackHost(proxyUrl);
      const headers: Record<string, string> = { "x-return-format": "html" };
      const apiKey = process.env.JINA_API_KEY;
      if (apiKey && apiKey.trim() !== "") {
        headers.authorization = `Bearer ${apiKey}`;
      }
      return fetchCore(proxyUrl, { headers }, timeoutMs);
    },
  };
}

/** Builds the Wayback Machine snapshot strategy for an already-validated origin URL. */
function waybackStrategy(originalUrl: string): Strategy {
  return {
    id: "wayback",
    isOrigin: false,
    run: async (_url, timeoutMs) => {
      // The `id_` suffix returns the ORIGINAL archived page without the Wayback
      // toolbar; a bare year resolves to the closest snapshot via redirect.
      const year = new Date().getUTCFullYear();
      const proxyUrl = `https://web.archive.org/web/${year}id_/${originalUrl}`;
      assertAllowedFallbackHost(proxyUrl);
      return fetchCore(proxyUrl, {}, timeoutMs);
    },
  };
}

/**
 * Builds the ordered strategy chain for an origin URL, honoring the env flags.
 * When the host has a remembered winning strategy, it is moved to the front so
 * subsequent fetches try it first and skip the slow chain.
 */
function buildChain(originalUrl: string, host: string): Strategy[] {
  const chain: Strategy[] = [
    {
      id: "origin",
      isOrigin: true,
      run: (url, timeoutMs) => fetchCore(url, {}, timeoutMs),
    },
  ];

  if (scraperFetchProfileRetry()) {
    for (const profile of PROFILES) {
      chain.push({
        id: `profile:${profile.name}`,
        isOrigin: true,
        run: (url, timeoutMs) => fetchCore(url, { headers: profile.headers }, timeoutMs),
      });
    }
  }

  if (scraperFetchBrowser()) {
    chain.push(browserStrategy(originalUrl));
  }

  if (scraperFetchReader()) {
    chain.push(readerStrategy(originalUrl));
  }
  if (scraperFetchWayback()) {
    chain.push(waybackStrategy(originalUrl));
  }

  const remembered = hostStrategyMemory.get(host);
  if (remembered) {
    const idx = chain.findIndex((s) => s.id === remembered);
    if (idx > 0) {
      const [preferred] = chain.splice(idx, 1);
      chain.unshift(preferred);
    }
  }

  return chain;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function runStrategyWith429Retry(
  strategy: Strategy,
  url: string,
  timeoutMs: number,
  deadline: number,
  deps: FetchHtmlWithStrategiesDeps,
): Promise<string> {
  const maxRetries = scraperFetch429Retries();
  const baseMs = scraperFetch429BaseMs();
  const maxMs = scraperFetch429MaxMs();
  const retryEnabled = maxRetries > 0 && baseMs > 0 && maxMs > 0;
  const sleep = deps.sleep ?? defaultSleep;
  const random = deps.random ?? Math.random;
  let retryAttempt = 0;

  for (;;) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new Error(`Fetch strategy timed out before attempt: ${strategy.id}`);
    }

    try {
      return await strategy.run(url, Math.min(timeoutMs, remaining));
    } catch (err) {
      if (!retryEnabled || !isRateLimit(err) || retryAttempt >= maxRetries) {
        throw err;
      }

      const now = Date.now();
      const remainingBeforeDelay = deadline - now;
      if (remainingBeforeDelay <= 0) {
        throw err;
      }

      retryAttempt += 1;
      const backoffMs = jitteredExponentialBackoff({
        attempt: retryAttempt,
        baseMs,
        maxMs,
        random,
      });
      const delayMs = err.retryAfterMs != null ? Math.max(err.retryAfterMs, backoffMs) : backoffMs;
      const clampedDelayMs = Math.min(delayMs, remainingBeforeDelay);
      if (clampedDelayMs <= 0 || deadline - (now + clampedDelayMs) <= 0) {
        throw err;
      }

      await sleep(clampedDelayMs);
    }
  }
}

/**
 * Runs the multi-strategy fallback chain for a GET `fetchHtml` request.
 *
 * Returns the first 2xx HTML body. A genuine not-found (404/410) or any
 * non-challenge error (SSRF rejection, timeout, too many redirects, network
 * failure) on an origin/profile attempt aborts immediately and propagates. If
 * every fallback is exhausted, the first bot-challenge error is rethrown.
 */
export async function fetchHtmlWithStrategies(
  url: string,
  timeoutMs: number = scraperTimeoutMs(),
  deps: FetchHtmlWithStrategiesDeps = {},
): Promise<string> {
  // SSRF-validate the ORIGINAL target up-front so reader/Wayback URLs are only
  // ever built from an already-validated public origin URL. Throws (no
  // fallback) for internal/private/non-http(s) URLs.
  await assertSafeUrl(url);

  const host = new URL(url).hostname;
  const chain = buildChain(url, host);

  const deadline = Date.now() + Math.max(timeoutMs, timeoutMs * OVERALL_BUDGET_FACTOR);
  let firstChallengeError: unknown = null;
  // Tracks the most recent 200-but-challenge body so, if the whole chain only
  // ever yields challenge pages, we throw a clear blocked error instead of
  // handing a challenge interstitial back to extraction.
  let sawContentChallenge = false;

  for (const strategy of chain) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    const attemptTimeout = Math.min(timeoutMs, remaining);

    try {
      const html = await runStrategyWith429Retry(strategy, url, attemptTimeout, deadline, deps);
      // A 2xx body can still be a bot-protection interstitial (HTTP 200 +
      // challenge page). Treat that exactly like a 403: do NOT accept it as the
      // result; escalate to the next strategy (next profile → reader → wayback).
      if (looksLikeBotChallenge(html)) {
        sawContentChallenge = true;
        if (firstChallengeError === null) {
          firstChallengeError = new BotChallengeError(host);
        }
        log.debug("strategy returned a 200 bot-challenge page; trying next", {
          host,
          strategy: strategy.id,
        });
        continue;
      }
      hostStrategyMemory.set(host, strategy.id);
      return html;
    } catch (err) {
      // Genuine not-found always aborts the chain, regardless of step type.
      if (isGenuineNotFound(err)) {
        throw err;
      }

      if (strategy.isOrigin) {
        // Origin/profile steps: only a bot challenge advances the chain. Any
        // other error (SSRF rejection, timeout, redirects, network) aborts so
        // SSRF/error semantics are never weakened by the fallback machinery.
        if (!isBotChallenge(err)) {
          throw err;
        }
        if (firstChallengeError === null) {
          firstChallengeError = err;
        }
        log.debug("origin/profile strategy bot-challenged; trying next", {
          host,
          strategy: strategy.id,
        });
        continue;
      }

      // Reader/Wayback steps are best-effort proxies: any failure simply moves
      // to the next fallback. The original challenge error is what we throw if
      // everything is exhausted.
      if (firstChallengeError === null) {
        firstChallengeError = err;
      }
      log.debug("fallback proxy strategy failed; trying next", {
        host,
        strategy: strategy.id,
      });
    }
  }

  if (sawContentChallenge && firstChallengeError instanceof BotChallengeError) {
    throw firstChallengeError;
  }
  throw firstChallengeError ?? new Error(`All fetch strategies failed for ${url}`);
}
