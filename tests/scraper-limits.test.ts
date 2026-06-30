/**
 * Tests for fetchHtml's response-size cap and request timeout
 * (src/lib/scraper/extract.ts + src/lib/scraper/limits.ts).
 *
 * The SSRF guard (resolveAndPin) and undici's fetch/Agent are mocked so no
 * DNS/network is touched. Verifies that:
 *   - a declared Content-Length over the cap is rejected before reading,
 *   - a streamed body that exceeds the cap is aborted mid-read,
 *   - a body within the cap is read and returned,
 *   - a stalled connect is aborted by the timeout,
 *   - a stalled body read is aborted by the timeout.
 */
process.env.LOG_LEVEL = "error";
// Small body cap so tests don't need megabytes; >= MIN_MAX_BYTES (256).
process.env.SCRAPER_MAX_BYTES = "1024";
import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

type Route = {
  status: number;
  location?: string;
  contentLength?: string;
  chunks?: string[];
  hangConnect?: boolean;
  hangBody?: boolean;
};

let routes: Record<string, Route> = {};

function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(enc.encode(chunks[i++]));
      } else {
        controller.close();
      }
    },
  });
}

function hangingStream(signal: AbortSignal | undefined): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const abort = () => controller.error(new Error("body aborted"));
      if (signal?.aborted) return abort();
      signal?.addEventListener("abort", abort);
    },
    // never enqueue/close — read() stays pending until the stream errors on abort
    pull() {},
  });
}

function fakeResponse(r: Route, signal: AbortSignal | undefined): Response {
  const headers = new Map<string, string>();
  if (r.location) headers.set("location", r.location);
  if (r.contentLength !== undefined) headers.set("content-length", r.contentLength);
  const body = r.hangBody
    ? hangingStream(signal)
    : r.chunks
      ? streamFromChunks(r.chunks)
      : null;
  return {
    status: r.status,
    ok: r.status >= 200 && r.status < 300,
    headers: { get: (name: string) => headers.get(name.toLowerCase()) ?? null },
    body,
    text: async () => (r.chunks ? r.chunks.join("") : ""),
  } as unknown as Response;
}

before(() => {
  mock.module("@/lib/scraper/ssrf", {
    namedExports: {
      resolveAndPin: async () => ({ ip: "93.184.216.34", family: 4 }),
      assertSafeUrl: async () => {},
      assertSafeHostname: async () => {},
      isPrivateAddress: () => false,
    },
  });

  mock.module("undici", {
    namedExports: {
      Agent: class {
        async close() {}
      },
      fetch: async (input: unknown, init?: { signal?: AbortSignal }): Promise<Response> => {
        const url = typeof input === "string" ? input : String(input);
        const r = routes[url];
        if (!r) throw new Error(`no route configured for ${url}`);
        if (r.hangConnect) {
          return await new Promise<Response>((_resolve, reject) => {
            if (init?.signal?.aborted) return reject(new Error("connect aborted"));
            init?.signal?.addEventListener("abort", () => reject(new Error("connect aborted")));
          });
        }
        return fakeResponse(r, init?.signal);
      },
    },
  });
});

beforeEach(() => {
  routes = {};
});

test("limits module honors env overrides with safe floors", async () => {
  const { scraperMaxBytes, scraperTimeoutMs } = await import("@/lib/scraper/limits");
  assert.equal(scraperMaxBytes(), 1024); // from process.env.SCRAPER_MAX_BYTES
  const prev = process.env.SCRAPER_TIMEOUT_MS;
  process.env.SCRAPER_TIMEOUT_MS = "5"; // below the 10ms floor -> falls back to default
  assert.equal(scraperTimeoutMs(), 15_000);
  process.env.SCRAPER_TIMEOUT_MS = "2500";
  assert.equal(scraperTimeoutMs(), 2500);
  if (prev === undefined) delete process.env.SCRAPER_TIMEOUT_MS;
  else process.env.SCRAPER_TIMEOUT_MS = prev;
});

test("fetchHtml rejects when declared Content-Length exceeds the cap", async () => {
  const { fetchHtml } = await import("@/lib/scraper/fetch");
  routes = {
    "https://safe.example/huge": { status: 200, contentLength: "999999", chunks: ["x"] },
  };
  await assert.rejects(fetchHtml("https://safe.example/huge"), /too large/i);
});

test("fetchHtml aborts a streamed body that exceeds the cap (lying/absent Content-Length)", async () => {
  const { fetchHtml } = await import("@/lib/scraper/fetch");
  // 4 chunks of 512 bytes = 2048 > 1024 cap; no content-length header at all.
  const chunk = "a".repeat(512);
  routes = {
    "https://safe.example/stream": { status: 200, chunks: [chunk, chunk, chunk, chunk] },
  };
  await assert.rejects(fetchHtml("https://safe.example/stream"), /too large/i);
});

test("fetchHtml returns a body within the cap", async () => {
  const { fetchHtml } = await import("@/lib/scraper/fetch");
  routes = {
    "https://safe.example/ok": { status: 200, chunks: ["<html>", "ok", "</html>"] },
  };
  const html = await fetchHtml("https://safe.example/ok");
  assert.equal(html, "<html>ok</html>");
});

test("fetchHtml aborts a stalled connect via the timeout", async () => {
  const { fetchHtml } = await import("@/lib/scraper/fetch");
  routes = { "https://slow.example/connect": { status: 200, hangConnect: true } };
  await assert.rejects(fetchHtml("https://slow.example/connect", 30), /connect aborted/);
});

test("fetchHtml aborts a stalled body read via the timeout", async () => {
  const { fetchHtml } = await import("@/lib/scraper/fetch");
  routes = { "https://slow.example/body": { status: 200, hangBody: true } };
  await assert.rejects(fetchHtml("https://slow.example/body", 30), /body aborted/);
});
