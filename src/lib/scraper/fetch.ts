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
  constructor(status: number, url: string) {
    super(`HTTP ${status} for ${url}`);
    this.name = "FetchHttpError";
    this.status = status;
    this.url = url;
  }
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
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Core SSRF-safe fetch shared by {@link fetchHtml}, {@link fetchText}, and the
 * multi-strategy fallback chain ({@link file://./fetch-strategies.ts}).
 * Validates every redirect hop through `resolveAndPin`, enforces a hard
 * timeout, and caps the response body at `scraperMaxBytes`. Throws
 * {@link FetchHttpError} (carrying the status) on a non-2xx final response.
 */
export async function fetchCore(url: string, init: FetchCoreInit, timeoutMs: number): Promise<string> {
  let host = "unknown";
  try {
    host = new URL(url).hostname;
  } catch {
    // keep "unknown" — never put a raw/invalid URL on a span attribute
  }
  return withSpan("scraper.fetch", { "readwise.provider": "scraper", "readwise.host": host }, async () => {
    const maxBytes = scraperMaxBytes();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let currentUrl = url;
      for (let hop = 0; ; hop++) {
        const pin = await resolveAndPin(currentUrl);
        const dispatcher = pinnedDispatcher(pin);

        let res: Awaited<ReturnType<typeof undiciFetch>>;
        try {
          res = await undiciFetch(currentUrl, {
            method: init.method ?? "GET",
            headers: {
              "user-agent": USER_AGENT,
              accept: init.method && init.method !== "GET" ? "application/json, */*" : "text/html",
              ...(init.headers ?? {}),
            },
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
        if (res.status >= 300 && res.status < 400 && location) {
          await res.body?.cancel().catch(() => {});
          void dispatcher.close();
          if (hop >= MAX_REDIRECTS) {
            throw new Error(`Too many redirects (> ${MAX_REDIRECTS}) starting from ${url}`);
          }
          currentUrl = new URL(location, currentUrl).href;
          continue;
        }

        try {
          if (!res.ok) {
            throw new FetchHttpError(res.status, currentUrl);
          }
          return await readBodyWithLimit(res, maxBytes);
        } finally {
          void dispatcher.close();
        }
      }
    } finally {
      clearTimeout(timer);
    }
  });
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
