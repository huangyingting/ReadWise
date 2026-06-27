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
 *   3. reader proxy      — `https://r.jina.ai/<url>` (cleaned HTML).
 *   4. Wayback snapshot  — `https://web.archive.org/web/<YYYY>id_/<url>`.
 *
 * Only a *bot-challenge* status advances the chain; a genuine not-found
 * (404/410) — or any SSRF/timeout/network error — aborts immediately and
 * bubbles up unchanged. A per-host, process-lifetime memory records the
 * winning strategy so subsequent fetches of the same host try it first and
 * skip the slow chain.
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
import { assertSafeUrl } from "@/lib/scraper/ssrf";
import { scraperTimeoutMs } from "@/lib/scraper/limits";
import {
  scraperFetchProfileRetry,
  scraperFetchReader,
  scraperFetchWayback,
} from "@/lib/runtime-config/scraper";
import { createLogger } from "@/lib/observability/logger";

const log = createLogger("scraper.fetch-strategies");

/** Statuses that indicate a bot challenge worth retrying with another strategy. */
const BOT_CHALLENGE_STATUSES = new Set([401, 403, 429, 451, 503]);

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

/** Per-host, process-lifetime memory of the strategy that last worked for a host. */
const hostStrategyMemory = new Map<string, string>();

function isFetchHttpError(err: unknown): err is FetchHttpError {
  return err instanceof FetchHttpError;
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
): Promise<string> {
  // SSRF-validate the ORIGINAL target up-front so reader/Wayback URLs are only
  // ever built from an already-validated public origin URL. Throws (no
  // fallback) for internal/private/non-http(s) URLs.
  await assertSafeUrl(url);

  const host = new URL(url).hostname;
  const chain = buildChain(url, host);

  const deadline = Date.now() + Math.max(timeoutMs, timeoutMs * OVERALL_BUDGET_FACTOR);
  let firstChallengeError: unknown = null;

  for (const strategy of chain) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    const attemptTimeout = Math.min(timeoutMs, remaining);

    try {
      const html = await strategy.run(url, attemptTimeout);
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

  throw firstChallengeError ?? new Error(`All fetch strategies failed for ${url}`);
}
