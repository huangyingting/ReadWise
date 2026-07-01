process.env.LOG_LEVEL = "error";

import { before, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";

type RouteRecord = {
  url: string;
  resourceType: string;
  action: "pending" | "abort" | "continue";
};

let routeRecords: RouteRecord[] = [];
let routeHandler: ((route: unknown) => Promise<void> | void) | null = null;
let contentSequence: string[] = [];
let waitCalls: number[] = [];
let contextClosed = 0;
let browserClosed = 0;
let launchRejects = false;
let disconnected: (() => void) | null = null;
let hostChecks: string[] = [];

let fetchResponseQueue: unknown[] = [];
let lookupCalls: unknown[] = [];
let agentClosed = 0;
let maxBytes = 1000;

function makeRoute(url: string, resourceType: string): unknown {
  const record: RouteRecord = { url, resourceType, action: "pending" };
  routeRecords.push(record);
  return {
    request: () => ({
      url: () => url,
      resourceType: () => resourceType,
    }),
    abort: async () => {
      record.action = "abort";
    },
    continue: async () => {
      record.action = "continue";
    },
  };
}

function response({
  status = 200,
  headers = {},
  text = "",
  body,
}: {
  status?: number;
  headers?: Record<string, string>;
  text?: string;
  body?: unknown;
} = {}): unknown {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: {
      get: (name: string) => headers[name.toLowerCase()] ?? headers[name] ?? null,
    },
    body,
    text: async () => text,
  };
}

before(() => {
  mock.module("@/lib/scraper/ssrf", {
    namedExports: {
      assertSafeUrl: async (url: string) => {
        if (url.includes("blocked")) throw new Error("blocked URL");
      },
      assertSafeHostname: async (hostname: string) => {
        hostChecks.push(hostname);
        if (hostname.includes("internal")) throw new Error("internal host");
      },
      isPrivateAddress: (address: string) => address === "127.0.0.1",
      resolveAndPin: async (url: string) => {
        try {
          new URL(url);
        } catch {
          throw new Error(`Invalid URL: ${url}`);
        }
        if (url.includes("private")) throw new Error("private address blocked");
        return { ip: "93.184.216.34", family: 4 };
      },
    },
  });
  mock.module("playwright", {
    namedExports: {
      chromium: {
        launch: async () => {
          if (launchRejects) throw new Error("browser unavailable");
          return {
            on: (_event: string, listener: () => void) => {
              disconnected = listener;
            },
            newContext: async () => ({
              route: async (_pattern: string, handler: (route: unknown) => Promise<void> | void) => {
                routeHandler = handler;
              },
              newPage: async () => ({
                goto: async () => {
                  assert.ok(routeHandler);
                  await routeHandler(makeRoute("data:text/plain,inline", "document"));
                  await routeHandler(makeRoute("https://example.com/photo.jpg", "image"));
                  await routeHandler(makeRoute("http://127.0.0.1/secret", "document"));
                  await routeHandler(makeRoute("https://cdn.example.com/app", "script"));
                  return { status: () => 202 };
                },
                content: async () => contentSequence.shift() ?? "<p>ready</p>",
                waitForTimeout: async (ms: number) => {
                  waitCalls.push(ms);
                },
              }),
              close: async () => {
                contextClosed++;
              },
            }),
            close: async () => {
              browserClosed++;
            },
          };
        },
      },
    },
  });
  mock.module("@/lib/scraper/limits", {
    namedExports: {
      scraperMaxBytes: () => maxBytes,
      scraperTimeoutMs: () => 1000,
    },
  });
  mock.module("@/lib/observability/tracing", {
    namedExports: {
      withSpan: async (_name: string, _attrs: unknown, fn: () => Promise<unknown>) => fn(),
    },
  });
  mock.module("undici", {
    namedExports: {
      Agent: class {
        constructor(options: { connect: { lookup: Function } }) {
          options.connect.lookup("example.com", { all: true }, (_err: unknown, addresses: unknown) => {
            lookupCalls.push(addresses);
          });
          options.connect.lookup("example.com", {}, (_err: unknown, address: unknown, family: unknown) => {
            lookupCalls.push({ address, family });
          });
        }
        close(): void {
          agentClosed++;
        }
      },
      fetch: async () => {
        const next = fetchResponseQueue.shift();
        if (next instanceof Error) throw next;
        if (!next) throw new Error("no fetch response queued");
        return next;
      },
    },
  });
});

beforeEach(async () => {
  routeRecords = [];
  routeHandler = null;
  contentSequence = [];
  waitCalls = [];
  contextClosed = 0;
  browserClosed = 0;
  launchRejects = false;
  disconnected = null;
  hostChecks = [];
  fetchResponseQueue = [];
  lookupCalls = [];
  agentClosed = 0;
  maxBytes = 1000;
  const { closeBrowser } = await import("@/lib/scraper/fetch-browser");
  await closeBrowser();
});

test("renderViaBrowser aborts unsafe/noisy routes, waits out challenges, and closes context", async () => {
  const { closeBrowser, renderViaBrowser } = await import("@/lib/scraper/fetch-browser");
  contentSequence = ["<html>Just a moment while we check your browser</html>", "<article>Ready</article>"];

  const rendered = await renderViaBrowser("https://example.com/article", 1000);

  assert.deepEqual(rendered, { status: 202, html: "<article>Ready</article>" });
  assert.ok(waitCalls.length >= 1);
  assert.equal(contextClosed, 1);
  assert.deepEqual(routeRecords.map((record) => [record.resourceType, record.action]), [
    ["document", "abort"],
    ["image", "abort"],
    ["document", "abort"],
    ["script", "continue"],
  ]);
  assert.ok(hostChecks.includes("cdn.example.com"));

  await closeBrowser();
  assert.equal(browserClosed, 1);
  disconnected?.();
  await closeBrowser();
});

test("closeBrowser tolerates a pending launch failure", async () => {
  const { closeBrowser, renderViaBrowser } = await import("@/lib/scraper/fetch-browser");
  launchRejects = true;

  const render = renderViaBrowser("https://example.com/article", 100);
  await Promise.resolve();
  await closeBrowser();

  await assert.rejects(render, /browser unavailable/);
  assert.equal(browserClosed, 0);
});

test("fetchCore parses retry-after dates and unparseable values on HTTP 429", async () => {
  const { FetchHttpError, fetchCore } = await import("@/lib/scraper/fetch");

  fetchResponseQueue = [
    response({
      status: 429,
      headers: { "retry-after": "Wed, 01 Jan 2020 00:00:00 GMT" },
    }),
  ];
  await assert.rejects(
    () => fetchCore("https://retry.example/article", {}, 1000),
    (err: unknown) => err instanceof FetchHttpError && err.retryAfterMs === 0,
  );

  fetchResponseQueue = [response({ status: 429, headers: { "retry-after": "later" } })];
  await assert.rejects(
    () => fetchCore("https://retry.example/article", {}, 1000),
    (err: unknown) => err instanceof FetchHttpError && err.retryAfterMs === undefined,
  );
  assert.ok(lookupCalls.length >= 4);
  assert.ok(agentClosed >= 2);
});

test("fetchCore enforces declared and fallback body byte limits", async () => {
  const { fetchCore } = await import("@/lib/scraper/fetch");
  maxBytes = 5;

  fetchResponseQueue = [
    response({
      status: 200,
      headers: { "content-length": "6" },
      text: "unused",
      body: null,
    }),
  ];
  await assert.rejects(
    () => fetchCore("https://large.example/article", {}, 1000),
    /Response too large: 6 bytes exceeds limit of 5 bytes/,
  );

  fetchResponseQueue = [response({ status: 200, text: "123456", body: null })];
  await assert.rejects(
    () => fetchCore("https://large.example/article", {}, 1000),
    /Response too large: exceeds limit of 5 bytes/,
  );
});

test("fetchCore streams successful bodies and closes dispatchers on transport errors", async () => {
  const { fetchCore } = await import("@/lib/scraper/fetch");
  const chunks = [Buffer.from("hello "), Buffer.from("world")];
  let index = 0;
  let cancelled = false;
  fetchResponseQueue = [
    response({
      status: 200,
      body: {
        getReader: () => ({
          read: async () =>
            index < chunks.length
              ? { done: false, value: chunks[index++] }
              : { done: true, value: undefined },
          cancel: async () => {
            cancelled = true;
          },
        }),
      },
    }),
  ];

  assert.equal(await fetchCore("https://stream.example/article", {}, 1000), "hello world");
  assert.equal(cancelled, true);

  fetchResponseQueue = [new Error("socket reset")];
  await assert.rejects(() => fetchCore("https://stream.example/error", {}, 1000), /socket reset/);
});

test("fetchCore preserves invalid URL failures after safe span labeling", async () => {
  const { fetchCore } = await import("@/lib/scraper/fetch");
  await assert.rejects(() => fetchCore("not a url", {}, 1000), /Invalid URL/);
});

test("fetchText forwards POST method, headers, and body to fetchCore", async () => {
  const { fetchText } = await import("@/lib/scraper/fetch");
  fetchResponseQueue = [response({ status: 200, text: "OK", body: null })];

  assert.equal(
    await fetchText(
      "https://api.example/graphql",
      { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
      1000,
    ),
    "OK",
  );
});
