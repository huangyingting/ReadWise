/**
 * SSRF-safe HTTP fetch layer for the scraper.
 *
 * Uses undici's own `fetch` + `Agent` (imported from "undici", NOT global fetch)
 * to pin the TCP connection to a pre-validated IP on every hop. This closes
 * the DNS-rebinding / TOCTOU gap: `resolveAndPin` validates ALL resolved
 * addresses before the first byte is sent, and the pinned dispatcher's `lookup`
 * short-circuits DNS so undici never re-resolves at connect time.
 *
 * All callers inside the scraper subsystem (`extract.ts`, `robots.ts`,
 * `index.ts`) should import `fetchHtml` / `fetchText` from here.
 */
import { resolveAndPin, type PinnedAddress } from "@/lib/scraper/ssrf";
import { scraperMaxBytes, scraperTimeoutMs } from "@/lib/scraper/limits";
import { withSpan } from "@/lib/observability/tracing";
import { Agent, fetch as undiciFetch } from "undici";
import { fetchHtmlWithStrategies } from "@/lib/scraper/fetch-strategies";
import { redactUrlForLog } from "@/lib/scraper/url-redaction";
import { createLogger } from "@/lib/observability/logger";
import { gunzipSync } from "node:zlib";

const log = createLogger("scraper.fetch");

const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/124.0 Safari/537.36 ReadWiseBot/1.0";

/** Max redirect hops followed before giving up. */
const MAX_REDIRECTS = 5;

/**
 * Error thrown by {@link fetchCore} on a non-2xx final response. Carries the
 * HTTP `status` so callers (e.g. the multi-strategy fallback chain in
 * {@link file://./fetch-strategies.ts}) can distinguish a bot-challenge
 * (401/403/429/451/503) — which is worth retrying with another strategy — from
 * a genuine not-found (404/410), which must bubble up unchanged.
 *
 * The message format (`HTTP <status> for <url>`) is preserved for backward
 * compatibility with existing callers/tests.
 */
export class FetchHttpError extends Error {
  readonly status: number;
  readonly url: string;
  readonly retryAfterMs?: number;
  constructor(status: number, url: string, retryAfterMs?: number) {
    super(`HTTP ${status} for ${url}`);
    this.name = "FetchHttpError";
    this.status = status;
    this.url = url;
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * Parses a `Retry-After` header value (seconds or HTTP-date) into ms.
 * Returns null when the header is absent or unparseable.
 */
function parseRetryAfterMs(header: string | null): number | null {
  if (!header) return null;
  const seconds = parseFloat(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const date = Date.parse(header);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  return null;
}

function spanHostFor(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    // keep "unknown" — never put a raw/invalid URL on a span attribute
    return "unknown";
  }
}

function requestHeaders(init: FetchCoreInit): Record<string, string> {
  return {
    "user-agent": USER_AGENT,
    accept: init.method && init.method !== "GET" ? "application/json, */*" : "text/html",
    ...(init.headers ?? {}),
  };
}

function decodeBodyBuffer(buffer: Buffer, maxBytes: number): string {
  if (buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b) {
    const decoded = gunzipSync(buffer);
    if (decoded.byteLength > maxBytes) {
      throw new Error(`Response too large: decompressed body exceeds limit of ${maxBytes} bytes`);
    }
    return decoded.toString("utf8");
  }
  return buffer.toString("utf8");
}

function isRedirect(status: number, location: string | null): location is string {
  return status >= 300 && status < 400 && Boolean(location);
}

function httpErrorFor(res: FetchResponse, url: string): FetchHttpError {
  if (res.status === 429) {
    const retryAfterMs = parseRetryAfterMs(res.headers.get("retry-after")) ?? undefined;
    return new FetchHttpError(res.status, url, retryAfterMs);
  }
  return new FetchHttpError(res.status, url);
}

/**
 * Builds a one-shot undici dispatcher that PINS the connection to the exact
 * pre-validated IP. The `lookup` short-circuits DNS so undici never re-resolves
 * the hostname at connect time (closing the DNS-rebinding / TOCTOU gap), while
 * `fetch(url)` still sends the correct `Host` header and TLS SNI for vhosts.
 */
function pinnedDispatcher(pin: PinnedAddress): Agent {
  return new Agent({
    connect: {
      lookup: (_hostname, options, callback) => {
        // undici/net may request all addresses (`all: true`) and then expects an
        // array; otherwise it expects the single (err, address, family) form.
        if (options && (options as { all?: boolean }).all) {
          callback(null, [{ address: pin.ip, family: pin.family }]);
        } else {
          callback(null, pin.ip, pin.family);
        }
      },
    },
  });
}

/** Options for {@link fetchText} (superset of {@link fetchHtml}'s GET-only call). */
export type FetchCoreInit = {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  /** Optional caller cancellation, composed with the built-in request timeout. */
  signal?: AbortSignal;
};

type FetchResponse = Awaited<ReturnType<typeof undiciFetch>>;

/**
 * Reads a response body as UTF-8 text while enforcing `maxBytes`.
 *
 * Defense in depth against oversized / decompression-bomb responses:
 *  1. Reject up-front when a declared `Content-Length` already exceeds the cap.
 *  2. Stream the body and count bytes as they arrive, aborting (cancelling the
 *     stream) the moment the running total would exceed the cap — Content-Length
 *     is advisory and may be absent or lie, so the streaming count is the real
 *     guard.
 *
 * Falls back to `res.text()` for response shapes without a readable stream
 * (still size-checked after the fact).
 */
async function readBodyWithLimit(res: FetchResponse, maxBytes: number): Promise<string> {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error(`Response too large: ${declared} bytes exceeds limit of ${maxBytes} bytes`);
  }

  const body = res.body as ReadableStream<Uint8Array> | null | undefined;
  if (!body || typeof body.getReader !== "function") {
    const text = await res.text();
    if (Buffer.byteLength(text, "utf8") > maxBytes) {
      throw new Error(`Response too large: exceeds limit of ${maxBytes} bytes`);
    }
    return text;
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        throw new Error(`Response too large: exceeds limit of ${maxBytes} bytes`);
      }
      chunks.push(value);
    }
  } finally {
    // Cancel releases the lock and tells undici to abort any unread body.
    await reader.cancel().catch(() => {});
  }
  return decodeBodyBuffer(Buffer.concat(chunks), maxBytes);
}

/**
 * Typed non-response outcome of the shared safe hop loop that stops BEFORE a
 * final response is consumed. Both {@link fetchCore} (which re-throws) and
 * {@link fetchDiscoveryResponse} (which maps to a typed result) build on top of
 * these so the SSRF/redirect machinery is defined exactly once.
 */
type SafeFetchStop =
  /** A hop's target resolved to a private/metadata address (or was otherwise SSRF-rejected). */
  | { kind: "blocked"; hop: number; error: Error }
  /** The redirect chain exceeded {@link MAX_REDIRECTS} hops. */
  | { kind: "too-many-redirects"; startUrl: string };

type SafeFetchResult<T> = { kind: "consumed"; value: T } | SafeFetchStop;

/**
 * The single SSRF-safe hop loop shared by every fetch entry point.
 *
 * Guarantees, enforced identically for the body-only path and the
 * discovery-metadata path (so neither can drift or weaken):
 *  - `resolveAndPin` validates + IP-pins EVERY hop (initial URL and every
 *    redirect target) before a byte is sent — closing the DNS-rebinding gap.
 *  - Redirects are followed manually and bounded by {@link MAX_REDIRECTS}.
 *  - A single {@link AbortController} enforces the hard timeout across all hops.
 *  - The pinned dispatcher is always closed; redirect bodies are cancelled.
 *
 * When a hop is SSRF-rejected or the redirect budget is exceeded the loop stops
 * WITHOUT invoking `consume` and returns a typed {@link SafeFetchStop}. On a
 * final (non-redirect) response `consume` runs while the dispatcher is still
 * open (so it can stream the body) and its result is returned as `consumed`.
 * Transport errors thrown by undici propagate unchanged.
 */
async function performSafeFetch<T>(
  url: string,
  init: FetchCoreInit,
  timeoutMs: number,
  consume: (res: FetchResponse, finalUrl: string) => Promise<T>,
): Promise<SafeFetchResult<T>> {
  const host = spanHostFor(url);
  return withSpan("scraper.fetch", { "readwise.provider": "scraper", "readwise.host": host }, async () => {
    const controller = new AbortController();
    const abortFromCaller = () => controller.abort(init.signal?.reason);
    if (init.signal?.aborted) {
      abortFromCaller();
    } else {
      init.signal?.addEventListener("abort", abortFromCaller, { once: true });
    }
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let currentUrl = url;
      for (let hop = 0; ; hop++) {
        let pin: PinnedAddress;
        try {
          pin = await resolveAndPin(currentUrl);
        } catch (err) {
          // SSRF rejection on any hop (initial or redirect target). Never echo
          // the raw target in a log — redact it. Callers map this to their own
          // outcome (thrown error for the body path, typed `blocked` result for
          // discovery) so the safe target is never fetched.
          return {
            kind: "blocked",
            hop,
            error: err instanceof Error ? err : new Error(String(err)),
          };
        }
        const dispatcher = pinnedDispatcher(pin);

        let res: FetchResponse;
        try {
          res = await undiciFetch(currentUrl, {
            method: init.method ?? "GET",
            headers: requestHeaders(init),
            body: init.body,
            signal: controller.signal,
            redirect: "manual",
            dispatcher,
          });
        } catch (err) {
          void dispatcher.close();
          throw err;
        }

        const location = res.headers.get("location");
        if (isRedirect(res.status, location)) {
          await res.body?.cancel().catch(() => {});
          void dispatcher.close();
          if (hop >= MAX_REDIRECTS) {
            return { kind: "too-many-redirects", startUrl: url };
          }
          currentUrl = new URL(location, currentUrl).href;
          continue;
        }

        try {
          const value = await consume(res, currentUrl);
          return { kind: "consumed", value };
        } finally {
          void dispatcher.close();
        }
      }
    } finally {
      clearTimeout(timer);
      init.signal?.removeEventListener("abort", abortFromCaller);
    }
  });
}

/**
 * Core SSRF-safe fetch shared by {@link fetchHtml}, {@link fetchText}, and the
 * multi-strategy fallback chain ({@link file://./fetch-strategies.ts}).
 * Validates every redirect hop through `resolveAndPin`, enforces a hard
 * timeout, and caps the response body at `scraperMaxBytes`. Throws
 * {@link FetchHttpError} (carrying the status) on a non-2xx final response.
 *
 * Built on the shared {@link performSafeFetch} hop loop so its SSRF/redirect
 * behavior is byte-for-byte identical to {@link fetchDiscoveryResponse}: the
 * typed stop outcomes are re-thrown here to preserve the historical (throwing)
 * contract that existing callers and tests depend on.
 */
export async function fetchCore(url: string, init: FetchCoreInit, timeoutMs: number): Promise<string> {
  const maxBytes = scraperMaxBytes();
  const result = await performSafeFetch(url, init, timeoutMs, async (res, finalUrl) => {
    if (!res.ok) {
      throw httpErrorFor(res, finalUrl);
    }
    return readBodyWithLimit(res, maxBytes);
  });

  if (result.kind === "consumed") return result.value;
  if (result.kind === "too-many-redirects") {
    throw new Error(`Too many redirects (> ${MAX_REDIRECTS}) starting from ${result.startUrl}`);
  }
  // Preserve the original SSRF rejection (and its message) for the body path.
  throw result.error;
}

/**
 * Fetches a URL as text (GET) with a desktop UA, a hard timeout and a body-size
 * cap. Throws on non-2xx or unsafe target.
 *
 * Internally this runs the multi-strategy fallback chain
 * ({@link file://./fetch-strategies.ts}): a plain origin request first (no
 * behavior change for pages that return 2xx), then — only when the origin is
 * bot-challenged (401/403/429/451/503) — rotating browser profiles, the
 * r.jina.ai reader proxy, and a Wayback Machine snapshot. The original URL is
 * SSRF-validated before any request and genuine not-found (404/410) responses
 * bubble up without triggering any fallback.
 */
export async function fetchHtml(url: string, timeoutMs = scraperTimeoutMs()): Promise<string> {
  return fetchHtmlWithStrategies(url, timeoutMs);
}

/**
 * SSRF-safe fetch that supports GET **and POST** (for API/GraphQL extractors).
 * Uses the same redirect validation, timeout, and body-size cap as
 * {@link fetchHtml}. The `init.body` is sent as-is; callers must set
 * `Content-Type` in `init.headers` when posting JSON.
 */
export async function fetchText(
  url: string,
  init: FetchCoreInit = {},
  timeoutMs = scraperTimeoutMs(),
): Promise<string> {
  return fetchCore(url, init, timeoutMs);
}

// ---------------------------------------------------------------------------
// Discovery response-metadata fetch (issue #1084)
// ---------------------------------------------------------------------------

/**
 * MINIMAL allowlist of content response headers surfaced to discovery adapters.
 * Deliberately NOT arbitrary headers — extractors never need `Set-Cookie`,
 * `Authorization` echoes, or vendor headers, so they are dropped at this seam.
 */
export type DiscoveryContentHeaders = {
  /** `Content-Type` header value (media type + params), when present. */
  contentType?: string;
};

/** HTTP validators + retry hint captured for conditional / retryable outcomes. */
export type DiscoveryValidators = {
  /** `ETag` validator, for a subsequent `If-None-Match` request. */
  etag?: string;
  /** `Last-Modified` validator, for a subsequent `If-Modified-Since` request. */
  lastModified?: string;
};

/**
 * Request options for {@link fetchDiscoveryResponse}. A superset of
 * {@link FetchCoreInit} with typed conditional-request convenience fields. When
 * both a convenience field and an explicit header are supplied the convenience
 * field wins (it is applied last).
 */
export type DiscoveryFetchInit = FetchCoreInit & {
  /** Sent as the `If-None-Match` request header (conditional GET on ETag). */
  ifNoneMatch?: string;
  /** Sent as the `If-Modified-Since` request header (conditional GET on date). */
  ifModifiedSince?: string;
};

/**
 * Reason a discovery fetch was refused by the safe hop loop (never fetched, or
 * stopped) — surfaced as a typed outcome so callers do not catch generic errors.
 */
export type DiscoveryBlockedReason = "unsafe-address" | "too-many-redirects";

/**
 * Typed result of {@link fetchDiscoveryResponse}. Discovery adapters branch on
 * `outcome` (never on thrown errors) to distinguish success, `304 Not Modified`,
 * a retryable status (429/5xx, with a parsed `Retry-After`), a blocked hop, and
 * a non-retryable HTTP error. Only the allowlisted metadata is exposed; response
 * bodies for non-200 outcomes are discarded, and blocked outcomes carry no URL.
 */
export type DiscoveryFetchResult =
  | {
      outcome: "ok";
      status: number;
      /** Final URL after all validated redirects (usable identity key for the caller). */
      finalUrl: string;
      /** Bounded, decoded response body (capped at `scraperMaxBytes`). */
      body: string;
      notModified: false;
      validators: DiscoveryValidators;
      headers: DiscoveryContentHeaders;
    }
  | {
      outcome: "not-modified";
      status: 304;
      finalUrl: string;
      notModified: true;
      validators: DiscoveryValidators;
    }
  | {
      outcome: "retryable";
      status: number;
      finalUrl: string;
      /** Parsed `Retry-After` (ms), when the server supplied a usable value. */
      retryAfterMs?: number;
    }
  | {
      outcome: "error";
      status: number;
      finalUrl: string;
    }
  | {
      outcome: "blocked";
      reason: DiscoveryBlockedReason;
    };

/**
 * Dependency-injectable shape of {@link fetchDiscoveryResponse} for the discovery
 * DI seam (mirrors `DiscoverDeps.fetchHtml`). Tests inject a stub returning a
 * canned {@link DiscoveryFetchResult} so RSS/API/sitemap/HTML discovery stays
 * network-free.
 */
export type DiscoveryFetch = (
  url: string,
  init?: DiscoveryFetchInit,
  timeoutMs?: number,
) => Promise<DiscoveryFetchResult>;

function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

function validatorsFrom(res: FetchResponse): DiscoveryValidators {
  const etag = res.headers.get("etag");
  const lastModified = res.headers.get("last-modified");
  return {
    ...(etag ? { etag } : {}),
    ...(lastModified ? { lastModified } : {}),
  };
}

function discoveryInitToCoreInit(init: DiscoveryFetchInit): FetchCoreInit {
  const headers: Record<string, string> = { ...(init.headers ?? {}) };
  if (init.ifNoneMatch !== undefined) headers["if-none-match"] = init.ifNoneMatch;
  if (init.ifModifiedSince !== undefined) headers["if-modified-since"] = init.ifModifiedSince;
  return {
    ...(init.method !== undefined ? { method: init.method } : {}),
    ...(init.body !== undefined ? { body: init.body } : {}),
    ...(init.signal !== undefined ? { signal: init.signal } : {}),
    headers,
  };
}

/**
 * SSRF-safe fetch that returns HTTP **response metadata** (status, final URL,
 * validators, retry hint, and a minimal content-header allowlist) instead of a
 * bare body, for incremental discovery adapters.
 *
 * It shares the exact same {@link performSafeFetch} hop loop as {@link fetchCore}
 * — identical DNS pinning, per-hop private/metadata rejection, manual bounded
 * redirects, timeout, and body-size cap — so it CANNOT weaken any SSRF guarantee.
 * Unlike {@link fetchHtml} it does NOT run the bot-challenge strategy rotation
 * (that behavior is reserved for article-body GETs); a conditional discovery
 * probe issues a single validated origin request per hop.
 *
 * Outcomes are typed (never thrown for HTTP-level results):
 *  - `200-299`  → `ok` (bounded body + validators + allowlisted headers).
 *  - `304`      → `not-modified` (no body; validators only).
 *  - `429/5xx`  → `retryable` (parsed `Retry-After`).
 *  - other 4xx  → `error` (status only).
 *  - SSRF-rejected hop / redirect-budget exceeded → `blocked` (no URL leaked).
 *
 * Privacy: nothing here logs or returns authorization headers, cookies, request
 * bodies, or full query strings; any URL that reaches a log is passed through
 * {@link redactUrlForLog}, and `blocked` outcomes intentionally omit the target.
 */
export async function fetchDiscoveryResponse(
  url: string,
  init: DiscoveryFetchInit = {},
  timeoutMs = scraperTimeoutMs(),
): Promise<DiscoveryFetchResult> {
  const maxBytes = scraperMaxBytes();
  const coreInit = discoveryInitToCoreInit(init);

  const result = await performSafeFetch(url, coreInit, timeoutMs, async (res, finalUrl): Promise<DiscoveryFetchResult> => {
    if (res.status === 304) {
      await res.body?.cancel().catch(() => {});
      return {
        outcome: "not-modified",
        status: 304,
        finalUrl,
        notModified: true,
        validators: validatorsFrom(res),
      };
    }

    if (res.ok) {
      const body = await readBodyWithLimit(res, maxBytes);
      const contentType = res.headers.get("content-type");
      return {
        outcome: "ok",
        status: res.status,
        finalUrl,
        body,
        notModified: false,
        validators: validatorsFrom(res),
        headers: contentType ? { contentType } : {},
      };
    }

    // Non-2xx, non-304, non-redirect: discard body, classify as retryable/error.
    await res.body?.cancel().catch(() => {});
    if (isRetryableStatus(res.status)) {
      const retryAfterMs = parseRetryAfterMs(res.headers.get("retry-after")) ?? undefined;
      return {
        outcome: "retryable",
        status: res.status,
        finalUrl,
        ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
      };
    }
    return { outcome: "error", status: res.status, finalUrl };
  });

  if (result.kind === "consumed") return result.value;

  if (result.kind === "too-many-redirects") {
    log.warn("discovery.fetch.too_many_redirects", { url: redactUrlForLog(result.startUrl) });
    return { outcome: "blocked", reason: "too-many-redirects" };
  }

  // SSRF-rejected hop — never surface the rejected target or the error's raw
  // message (it may embed the private address); log only the redacted request URL.
  log.warn("discovery.fetch.blocked", { url: redactUrlForLog(url), hop: result.hop });
  return { outcome: "blocked", reason: "unsafe-address" };
}
