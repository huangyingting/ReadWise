process.env.LOG_LEVEL = "error";

import { after, before, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";

type ProviderLike = {
  key: string;
  name: string;
  hostnames: string[];
};

type SaveOutcomeLike =
  | { status: "saved"; id: string; article: ReturnType<typeof articleFor> }
  | { status: "skipped"; reason: string; sourceUrl: string }
  | { status: "failed"; reason: string; sourceUrl: string };

const stateRoot = path.resolve(
  ".scraper-state/script-coverage-scrapers",
);

const providers: ProviderLike[] = [
  { key: "fixture", name: "Fixture News", hostnames: ["example.com"] },
  { key: "undark", name: "Undark", hostnames: ["undark.org"] },
  {
    key: "smithsonian",
    name: "Smithsonian Magazine",
    hostnames: ["smithsonianmag.com", "www.smithsonianmag.com"],
  },
  { key: "disabled", name: "Disabled Source", hostnames: ["disabled.test"] },
];
const providerByKey = new Map(providers.map((provider) => [provider.key, provider]));

let scrape: any;
let scrapeReview: any;
let scrapeUndark: any;
let scrapeSmithsonian: any;

let extractArticleImpl: (html: string, url: string) => ReturnType<typeof articleFor> | null;
let fetchHtmlImpl: (url: string) => Promise<string>;
let qualityImpl: (article: unknown) => unknown;
let scrapeUrlImpl: (url: string) => Promise<ReturnType<typeof articleFor> | null>;
let saveDraftArticleImpl: (article: ReturnType<typeof articleFor>) => Promise<SaveOutcomeLike>;
let scrapeAndSaveImpl: (url: string) => Promise<SaveOutcomeLike>;
let discoverImpl: (
  provider: ProviderLike,
  limit: number,
  options?: unknown,
) => Promise<string[]>;
let findExistingImpl: (urls: string[]) => Promise<Set<string>>;
let providerEnabledImpl: (key: string) => Promise<boolean>;
let recordCrawlImpl: (key: string, outcome: unknown) => Promise<void>;
let closeBrowserImpl: () => Promise<void>;

let recordCrawlCalls: Array<{ key: string; outcome: unknown }> = [];
let discoverCalls: Array<{ provider: ProviderLike; limit: number; options?: unknown }> = [];
let findExistingCalls: string[][] = [];
let closeBrowserCalls = 0;
let smithsonianProviderConfigs: unknown[] = [];

let prismaFindManyImpl: (args: any) => Promise<any[]>;
let prismaCountImpl: (args: any) => Promise<number>;
let prismaUpdateManyImpl: (args: any) => Promise<{ count: number }>;
let prismaUpdateImpl: (args: any) => Promise<unknown>;
let prismaFindManyCalls: any[] = [];
let prismaCountCalls: any[] = [];
let prismaUpdateManyCalls: any[] = [];
let prismaUpdateCalls: any[] = [];

let prismaClientCtorArgs: any[] = [];
let prismaClientFindManyImpl: (args: any) => Promise<any[]>;
let prismaClientFindManyCalls: any[] = [];
let prismaClientDisconnects = 0;

function articleFor(url: string, source = "Fixture News") {
  return {
    title: `Fixture article for ${new URL(url).hostname}`,
    author: "Fixture Author",
    source,
    sourceUrl: url,
    heroImage: "https://example.com/hero.jpg",
    excerpt: "Fixture excerpt.",
    content:
      "<p>Fixture body uses harmless synthetic words for scraper coverage.</p>",
    category: "science",
    publishedAt: new Date("2026-01-02T00:00:00.000Z"),
    wordCount: 9,
    readingMinutes: 1,
  };
}

function savedOutcome(url: string, source = "Fixture News"): SaveOutcomeLike {
  return { status: "saved", id: `id-${url.replace(/\W+/g, "-")}`, article: articleFor(url, source) };
}

function scrapeArgs(overrides: Record<string, unknown> = {}) {
  return {
    urls: [],
    provider: null,
    all: false,
    limit: 5,
    file: null,
    fileUrl: null,
    dryRun: false,
    listProviders: false,
    help: false,
    ...overrides,
  };
}

function captureConsole(t: any) {
  const logs: string[] = [];
  const warns: string[] = [];
  const errors: string[] = [];
  t.mock.method(console, "log", (...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  });
  t.mock.method(console, "warn", (...args: unknown[]) => {
    warns.push(args.map(String).join(" "));
  });
  t.mock.method(console, "error", (...args: unknown[]) => {
    errors.push(args.map(String).join(" "));
  });
  return { logs, warns, errors };
}

async function resetStateRoot(): Promise<void> {
  await rm(stateRoot, { recursive: true, force: true });
  await mkdir(stateRoot, { recursive: true });
}

function statePath(name: string): string {
  return path.join(stateRoot, name);
}

function providerForUrl(url: string): ProviderLike | null {
  const hostname = new URL(url).hostname.replace(/^www\./, "");
  return (
    providers.find((provider) =>
      provider.hostnames.some((host) => host.replace(/^www\./, "") === hostname),
    ) ?? null
  );
}

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, " ");
}

class FakePrismaClient {
  article = {
    findMany: async (args: any) => {
      prismaClientFindManyCalls.push(args);
      return prismaClientFindManyImpl(args);
    },
  };

  constructor(args: any) {
    prismaClientCtorArgs.push(args);
  }

  async $disconnect(): Promise<void> {
    prismaClientDisconnects += 1;
  }
}

before(async () => {
  mock.module("@prisma/client", {
    namedExports: {
      PrismaClient: FakePrismaClient,
      ArticleStatus: { DRAFT: "DRAFT", PUBLISHED: "PUBLISHED" },
      ArticleVisibility: { PRIVATE: "PRIVATE", PUBLIC: "PUBLIC" },
    },
  });
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        article: {
          findMany: async (args: any) => {
            prismaFindManyCalls.push(args);
            return prismaFindManyImpl(args);
          },
          count: async (args: any) => {
            prismaCountCalls.push(args);
            return prismaCountImpl(args);
          },
          updateMany: async (args: any) => {
            prismaUpdateManyCalls.push(args);
            return prismaUpdateManyImpl(args);
          },
          update: async (args: any) => {
            prismaUpdateCalls.push(args);
            return prismaUpdateImpl(args);
          },
        },
        $transaction: async (operations: Array<Promise<unknown>>) =>
          Promise.all(operations),
        $disconnect: async () => {},
      },
    },
  });
  mock.module("@/lib/scraper/extract", {
    namedExports: {
      extractArticle: (html: string, url: string) => extractArticleImpl(html, url),
      stripTags,
    },
  });
  mock.module("@/lib/scraper/fetch", {
    namedExports: { fetchHtml: (url: string) => fetchHtmlImpl(url) },
  });
  mock.module("@/lib/scraper/fetch-browser", {
    namedExports: {
      closeBrowser: async () => {
        closeBrowserCalls += 1;
        await closeBrowserImpl();
      },
    },
  });
  mock.module("@/lib/scraper/quality", {
    namedExports: {
      checkContentQuality: (article: unknown) => qualityImpl(article),
    },
  });
  mock.module("@/lib/scraper", {
    namedExports: {
      scrapeUrl: (url: string) => scrapeUrlImpl(url),
      saveDraftArticle: (article: ReturnType<typeof articleFor>) =>
        saveDraftArticleImpl(article),
      scrapeAndSave: (url: string) => scrapeAndSaveImpl(url),
    },
  });
  mock.module("@/lib/scraper/discovery", {
    namedExports: {
      discoverProviderUrls: async (
        provider: ProviderLike,
        limit: number,
        options?: unknown,
      ) => {
        discoverCalls.push({ provider, limit, options });
        return discoverImpl(provider, limit, options);
      },
    },
  });
  mock.module("@/lib/article-library/policy", {
    namedExports: {
      findExistingPublicLibrarySourceUrls: async (urls: string[]) => {
        findExistingCalls.push([...urls]);
        return findExistingImpl(urls);
      },
    },
  });
  mock.module("@/lib/scraper/providers", {
    namedExports: {
      PROVIDERS: providers,
      getProvider: (key: string) => providerByKey.get(key) ?? null,
      providerForUrl,
    },
  });
  mock.module("@/lib/scraper/providers/smithsonian", {
    namedExports: {
      createSmithsonianProvider: (config: unknown) => {
        smithsonianProviderConfigs.push(config);
        return providerByKey.get("smithsonian");
      },
    },
  });
  mock.module("@/lib/scraper/sources", {
    namedExports: {
      isProviderEnabled: (key: string) => providerEnabledImpl(key),
      recordCrawlRun: (key: string, outcome: unknown) =>
        recordCrawlImpl(key, outcome),
    },
  });

  scrape = await import("../scripts/scrape");
  scrapeReview = await import("../scripts/scrape-review");
  scrapeUndark = await import("../scripts/scrape-undark");
  scrapeSmithsonian = await import("../scripts/scrape-smithsonian");
});

beforeEach(() => {
  extractArticleImpl = (_html, url) => articleFor(url);
  fetchHtmlImpl = async () => "<article><p>Fixture fetched body.</p></article>";
  qualityImpl = () => ({
    grade: "A",
    score: 97,
    signals: [
      { check: "length", passed: true },
      { check: "metadata", passed: false },
    ],
  });
  scrapeUrlImpl = async (url) => articleFor(url);
  saveDraftArticleImpl = async (article) => ({
    status: "saved",
    id: "draft-fixture",
    article,
  });
  scrapeAndSaveImpl = async (url) => savedOutcome(url, providerForUrl(url)?.name);
  discoverImpl = async (provider, limit) =>
    [`https://${provider.hostnames[0]}/fresh-one`, `https://${provider.hostnames[0]}/fresh-two`].slice(
      0,
      Number.isFinite(limit) ? limit : 2,
    );
  findExistingImpl = async () => new Set<string>();
  providerEnabledImpl = async () => true;
  recordCrawlImpl = async (key, outcome) => {
    recordCrawlCalls.push({ key, outcome });
  };
  closeBrowserImpl = async () => {};

  recordCrawlCalls = [];
  discoverCalls = [];
  findExistingCalls = [];
  closeBrowserCalls = 0;
  smithsonianProviderConfigs = [];

  prismaFindManyImpl = async () => [];
  prismaCountImpl = async () => 0;
  prismaUpdateManyImpl = async () => ({ count: 0 });
  prismaUpdateImpl = async () => ({});
  prismaFindManyCalls = [];
  prismaCountCalls = [];
  prismaUpdateManyCalls = [];
  prismaUpdateCalls = [];

  prismaClientCtorArgs = [];
  prismaClientFindManyImpl = async () => [];
  prismaClientFindManyCalls = [];
  prismaClientDisconnects = 0;
});

after(async () => {
  await rm(stateRoot, { recursive: true, force: true });
});

test("scrape.ts exercises file, URL, provider, main, and CLI cleanup paths", async (t) => {
  const consoleCapture = captureConsole(t);
  await resetStateRoot();
  const htmlPath = statePath("local-article.html");
  await writeFile(htmlPath, "<article>synthetic fixture</article>", "utf8");

  assert.equal(scrape.parseArgs(["--file", "a.html", "--url", "https://example.com/a", "--unknown"]).file, "a.html");
  assert.equal(scrape.parseArgs(["--dry-run", "--list-providers"]).dryRun, true);
  assert.equal(scrape.parseArgs(["--dry-run", "--list-providers"]).listProviders, true);
  assert.match(consoleCapture.warns.join("\n"), /Unknown flag: --unknown/);

  const fileSaved = await scrape.__scrapeTest.runFile(
    scrapeArgs({
      file: htmlPath,
      fileUrl: "https://example.com/local",
      dryRun: false,
    }),
  );
  assert.equal(fileSaved[0].status, "saved");

  const fileDryRun = await scrape.__scrapeTest.runFile(
    scrapeArgs({ file: htmlPath, dryRun: true }),
  );
  assert.deepEqual(fileDryRun, [
    { status: "skipped", reason: "dry-run", sourceUrl: `file://${htmlPath}` },
  ]);

  extractArticleImpl = () => null;
  const fileFailed = await scrape.__scrapeTest.runFile(
    scrapeArgs({ file: htmlPath, fileUrl: "https://example.com/failed" }),
  );
  assert.deepEqual(fileFailed, [
    {
      status: "failed",
      reason: "could not extract article content",
      sourceUrl: "https://example.com/failed",
    },
  ]);
  assert.deepEqual(await scrape.__scrapeTest.runFile(scrapeArgs()), []);

  scrapeUrlImpl = async (url) => {
    if (url.includes("none")) return null;
    if (url.includes("throw")) throw new Error("scrapeUrl failed");
    return articleFor(url);
  };
  const dryUrlOutcomes = await scrape.__scrapeTest.runUrls(
    [
      "https://example.com/dry",
      "https://example.com/none",
      "https://example.com/throw",
    ],
    true,
  );
  assert.deepEqual(
    dryUrlOutcomes.map((outcome: SaveOutcomeLike) => outcome.status),
    ["skipped", "failed", "failed"],
  );

  scrapeAndSaveImpl = async (url) =>
    url.includes("bad")
      ? { status: "failed", reason: "network failed", sourceUrl: url }
      : savedOutcome(url);
  const savedUrls = await scrape.__scrapeTest.runUrls(
    ["https://example.com/save", "https://example.com/bad"],
    false,
  );
  assert.deepEqual(
    savedUrls.map((outcome: SaveOutcomeLike) => outcome.status),
    ["saved", "failed"],
  );

  providerEnabledImpl = async (key) => key !== "disabled";
  assert.deepEqual(
    await scrape.__scrapeTest.runProvider(providerByKey.get("disabled"), 2, false),
    [],
  );

  discoverImpl = async (provider) => [
    `https://${provider.hostnames[0]}/fresh`,
    `https://${provider.hostnames[0]}/already`,
  ];
  findExistingImpl = async (urls) =>
    new Set(urls.filter((url) => url.includes("already")));
  const providerOutcomes = await scrape.__scrapeTest.runProvider(
    providerByKey.get("fixture"),
    5,
    false,
  );
  assert.equal(providerOutcomes.length, 1);
  assert.equal(findExistingCalls.length, 1);
  assert.equal(recordCrawlCalls.at(-1)?.key, "fixture");

  discoverImpl = async () => {
    throw new Error("discovery failed");
  };
  const discoveryFailure = await scrape.__scrapeTest.runProvider(
    providerByKey.get("fixture"),
    5,
    false,
  );
  assert.deepEqual(discoveryFailure, []);
  assert.match(
    JSON.stringify(recordCrawlCalls.at(-1)?.outcome),
    /discovery failed/,
  );

  findExistingImpl = async () => {
    throw new Error("prefilter failed");
  };
  discoverImpl = async (provider) => [`https://${provider.hostnames[0]}/fresh`];
  await scrape.__scrapeTest.runProvider(providerByKey.get("fixture"), 5, false);
  assert.match(consoleCapture.warns.join("\n"), /could not pre-filter/);

  recordCrawlImpl = async () => {
    throw new Error("record failed");
  };
  await scrape.__scrapeTest.runProvider(providerByKey.get("fixture"), 5, false);
  assert.match(consoleCapture.warns.join("\n"), /could not record crawl health/);
  recordCrawlImpl = async (key, outcome) => {
    recordCrawlCalls.push({ key, outcome });
  };
  extractArticleImpl = (_html, url) => articleFor(url);

  assert.equal(await scrape.__scrapeTest.main(["--help"]), 0);
  assert.equal(await scrape.__scrapeTest.main(["--list-providers"]), 0);
  assert.equal(await scrape.__scrapeTest.main(["--provider", "missing"]), 1);
  assert.equal(await scrape.__scrapeTest.main([]), 0);
  assert.equal(await scrape.__scrapeTest.main(["--file", htmlPath]), 0);
  assert.equal(await scrape.__scrapeTest.main(["--provider", "fixture", "--limit", "1"]), 0);
  assert.equal(await scrape.__scrapeTest.main(["https://example.com/save"]), 0);
  assert.equal(await scrape.__scrapeTest.main(["--all", "--limit", "1"]), 0);

  closeBrowserImpl = async () => {
    throw new Error("ignored cleanup failure");
  };
  await new Promise<void>((resolve) => {
    scrape.__scrapeTest.runScrapeCli(["--help"], {
      disconnect: async () => {
        resolve();
      },
      exit: (() => undefined) as never,
      error: (err: unknown) => assert.fail(String(err)),
    });
  });
  assert.equal(closeBrowserCalls, 1);
});

function dbRow(id: string, sourceUrl = `https://example.com/${id}`) {
  return {
    id,
    title: `DB ${id}`,
    author: "DB Author",
    source: "Fixture News",
    sourceUrl,
    heroImage: null,
    excerpt: "DB excerpt",
    content: "<p>Stored fixture article words.</p>",
    category: "history",
    publishedAt: new Date("2026-02-03T00:00:00.000Z"),
    wordCount: null,
    readingMinutes: null,
  };
}

function reviewItem(id = "review-1") {
  return {
    id,
    mode: "preview",
    articleId: null,
    url: "https://example.com/review",
    title: "Review fixture",
    source: "Fixture News",
    provider: "fixture",
    author: "Fixture Author",
    category: "science",
    publishedAt: "2026-01-02T00:00:00.000Z",
    wordCount: 9,
    readingMinutes: 1,
    heroImage: null,
    excerpt: "Fixture excerpt.",
    content: "<p>Review fixture body.</p>",
    textPreview: "Review fixture body.",
    quality: {
      grade: "A",
      score: 97,
      failedChecks: ["metadata"],
      signals: [{ check: "metadata", passed: false }],
    },
    status: "extracted",
    error: null,
  };
}

function fakeReq(method: string, url: string, body?: string): IncomingMessage {
  const chunks = body == null ? [] : [Buffer.from(body)];
  return {
    method,
    url,
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk;
    },
  } as unknown as IncomingMessage;
}

type FakeResponse = ServerResponse & {
  statusCode: number;
  body: string;
  headers: Record<string, string> | undefined;
};

function fakeRes(): FakeResponse {
  return {
    statusCode: 0,
    body: "",
    headers: undefined,
    writeHead(this: FakeResponse, status: number, headers: Record<string, string>) {
      this.statusCode = status;
      this.headers = headers;
      return this;
    },
    end(this: FakeResponse, chunk?: unknown) {
      if (chunk != null) this.body += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
      return this;
    },
  } as unknown as FakeResponse;
}

test("scrape-review covers preview, DB loading, routing, server startup, and main seams", async (t) => {
  const consoleCapture = captureConsole(t);
  await resetStateRoot();
  const urlsFile = statePath("review-urls.txt");
  await writeFile(
    urlsFile,
    [
      "https://example.com/from-file#fragment",
      "not a url",
      "https://example.com/from-file",
    ].join("\n"),
    "utf8",
  );

  const args = scrapeReview.parseArgs([
    "--no-db",
    "--urls",
    urlsFile,
    "--url",
    "https://example.com/direct",
    "--discover",
    "--provider",
    "fixture",
    "--limit",
    "5",
    "--order",
    "sideways",
    "--host",
    "127.0.0.1",
    "--port",
    "bad",
    "--feedback-file",
    "none",
    "--unknown",
  ]);
  const positionalArgs = scrapeReview.parseArgs([
    "--feedback-none",
    "https://example.com/positional",
  ]);
  assert.equal(positionalArgs.feedbackFile, null);
  assert.deepEqual(positionalArgs.urls, ["https://example.com/positional"]);
  discoverImpl = async () => [
    "https://example.com/discovered",
    "https://example.com/direct#again",
  ];
  const previewUrls = await scrapeReview.__scrapeReviewTest.collectPreviewUrls(args);
  assert.deepEqual(previewUrls, [
    "https://example.com/from-file",
    "https://example.com/direct",
    "https://example.com/discovered",
  ]);
  assert.match(consoleCapture.warns.join("\n"), /Skipping invalid URL: not a url/);

  const previewItems = await scrapeReview.__scrapeReviewTest.loadPreviewItems({
    ...args,
    limit: 2,
  });
  assert.equal(previewItems.length, 2);
  assert.equal(previewItems[0].status, "extracted");

  extractArticleImpl = () => null;
  assert.equal(
    (await scrapeReview.__scrapeReviewTest.previewUrl("https://example.com/no-article")).status,
    "failed",
  );
  fetchHtmlImpl = async () => {
    throw new Error("fetch failed");
  };
  assert.match(
    (await scrapeReview.__scrapeReviewTest.previewUrl("https://example.com/error")).error,
    /fetch failed/,
  );
  await assert.rejects(
    () =>
      scrapeReview.__scrapeReviewTest.loadPreviewItems({
        ...args,
        urls: [],
        urlsFile: null,
        discover: false,
      }),
    /No preview URLs/,
  );

  prismaClientFindManyImpl = async () => [dbRow("newest")];
  const dbItems = await scrapeReview.__scrapeReviewTest.loadDbReviewItems(
    scrapeReview.parseArgs(["--db", "prisma/fixture.db", "--provider", "fixture"]),
  );
  assert.equal(dbItems[0].mode, "db");
  assert.equal(prismaClientDisconnects, 1);
  assert.match(
    prismaClientCtorArgs[0].datasources.db.url,
    /^file:/,
  );

  const queuedRows = [[{ id: "row-2" }, { id: "row-1" }], [dbRow("row-1"), dbRow("row-2")]];
  prismaClientFindManyImpl = async () => queuedRows.shift() ?? [];
  t.mock.method(Math, "random", () => 0);
  const randomItems = await scrapeReview.__scrapeReviewTest.loadDbReviewItems(
    scrapeReview.parseArgs(["--db", "file:review.db", "--sample", "2"]),
  );
  assert.equal(randomItems.length, 2);
  assert.deepEqual(
    await scrapeReview.__scrapeReviewTest.fetchArticlesByIds(new FakePrismaClient({}), []),
    [],
  );

  assert.throws(() => scrapeReview.__scrapeReviewTest.requireProvider(null), /required/);
  assert.throws(() => scrapeReview.__scrapeReviewTest.requireProvider("missing"), /Unknown provider/);
  assert.equal(scrapeReview.__scrapeReviewTest.countWords(" one  two "), 2);
  assert.equal(
    scrapeReview.__scrapeReviewTest.previewText("<p>one</p><p>two</p>"),
    "one two",
  );
  assert.equal(
    scrapeReview.__scrapeReviewTest.jsonForScript({ tag: "</script>" }).includes("\\u003c"),
    true,
  );

  const item = reviewItem();
  const feedbackFile = statePath("feedback.jsonl");
  const routeArgs = { ...scrapeReview.parseArgs(["--no-db"]), feedbackFile };
  const ctx = {
    args: routeArgs,
    items: [item],
    itemById: new Map([[item.id, item]]),
    feedbackFile,
    mode: "preview",
  };

  let res = fakeRes();
  await scrapeReview.__scrapeReviewTest.routeRequest(fakeReq("GET", "/"), res, ctx);
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Scrape Review/);

  res = fakeRes();
  await scrapeReview.__scrapeReviewTest.routeRequest(fakeReq("GET", "/api/articles"), res, ctx);
  assert.equal(JSON.parse(res.body).articles.length, 1);

  res = fakeRes();
  await scrapeReview.__scrapeReviewTest.routeRequest(fakeReq("GET", "/healthz"), res, ctx);
  assert.deepEqual(JSON.parse(res.body), { ok: true, count: 1 });

  res = fakeRes();
  await scrapeReview.__scrapeReviewTest.routeRequest(
    fakeReq("POST", "/api/feedback", JSON.stringify({ itemId: item.id, note: "Needs cleanup" })),
    res,
    ctx,
  );
  assert.equal(JSON.parse(res.body).stored, true);
  assert.match(await readFile(feedbackFile, "utf8"), /Needs cleanup/);

  res = fakeRes();
  await scrapeReview.__scrapeReviewTest.routeRequest(fakeReq("GET", "/missing"), res, ctx);
  assert.equal(res.statusCode, 404);

  assert.throws(
    () => scrapeReview.__scrapeReviewTest.validateFeedback({}, ctx.itemById, "preview"),
    /itemId is required/,
  );
  assert.throws(
    () =>
      scrapeReview.__scrapeReviewTest.validateFeedback(
        { itemId: "missing", feedback: "x" },
        ctx.itemById,
        "preview",
      ),
    /Unknown itemId/,
  );
  assert.throws(
    () =>
      scrapeReview.__scrapeReviewTest.validateFeedback(
        { itemId: item.id, feedback: "   " },
        ctx.itemById,
        "preview",
      ),
    /feedback text is required/,
  );
  await assert.rejects(
    () =>
      scrapeReview.__scrapeReviewTest.readJsonBody(
        fakeReq("POST", "/api/feedback", "x".repeat(70 * 1024)),
      ),
    /request body too large/,
  );

  const server = await scrapeReview.__scrapeReviewTest.startReviewServer(
    { ...routeArgs, port: 0 },
    [item],
    "preview",
  );
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const health = await fetch(`http://127.0.0.1:${port}/healthz`);
  assert.equal(health.status, 200);
  const badFeedback = await fetch(`http://127.0.0.1:${port}/api/feedback`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{ invalid",
  });
  assert.equal(badFeedback.status, 500);
  await new Promise<void>((resolve) => server.close(() => resolve()));

  const started: unknown[] = [];
  closeBrowserImpl = async () => {};
  const mainCode = await scrapeReview.__scrapeReviewTest.main(
    ["--no-db", "--url", "https://example.com/main"],
    {
      loadPreviewItems: async () => [item],
      closeBrowser: async () => {
        closeBrowserCalls += 1;
      },
      startReviewServer: async (...values: unknown[]) => {
        started.push(values);
      },
    },
  );
  assert.equal(mainCode, 0);
  assert.equal(started.length, 1);
  assert.equal(closeBrowserCalls, 1);
  assert.equal(await scrapeReview.__scrapeReviewTest.main(["--help"]), 0);
  await assert.rejects(
    () =>
      scrapeReview.__scrapeReviewTest.main(["--no-db", "--db", "file:bad"], {
        closeBrowser: async () => {},
      }),
    /Use either/,
  );
  await assert.rejects(
    () =>
      scrapeReview.__scrapeReviewTest.main(["--no-db"], {
        loadPreviewItems: async () => [],
        closeBrowser: async () => {},
        startReviewServer: async () => {},
      }),
    /No review items loaded/,
  );
});

test("scrape-undark covers state, discovery, scrape, DB, publish, and main paths", async (t) => {
  captureConsole(t);
  await resetStateRoot();
  const visitedPath = statePath("undark-visited.json");
  scrapeUndark.parseArgs(["--unknown"]);
  assert.deepEqual(
    await scrapeUndark.__scrapeUndarkTest.readVisited(visitedPath),
    { version: 1, provider: "undark", updatedAt: new Date(0).toISOString(), urls: [] },
  );
  assert.throws(
    () => scrapeUndark.__scrapeUndarkTest.resolveRepoLocalPath("../outside.json"),
    /inside the repository/,
  );
  assert.equal(scrapeUndark.__scrapeUndarkTest.normalizeUrl("not a url"), null);
  assert.equal(scrapeUndark.__scrapeUndarkTest.errorMessage("plain"), "plain");
  assert.equal(scrapeUndark.__scrapeUndarkTest.isVisitedRecord({}), false);

  const record = await scrapeUndark.__scrapeUndarkTest.readVisited(visitedPath);
  scrapeUndark.__scrapeUndarkTest.markVisited(record, "not a url", "failed");
  scrapeUndark.__scrapeUndarkTest.markVisited(
    record,
    "https://undark.org/2026/01/seen#comments",
    "saved",
  );
  scrapeUndark.__scrapeUndarkTest.markVisited(
    record,
    "https://undark.org/2026/01/seen",
    "duplicate",
  );
  await scrapeUndark.__scrapeUndarkTest.writeVisited(visitedPath, record);
  const writtenRecord = await scrapeUndark.__scrapeUndarkTest.readVisited(visitedPath);
  assert.equal(writtenRecord.urls.length, 1);
  assert.equal(writtenRecord.urls[0].lastOutcome, "duplicate");

  await writeFile(visitedPath, "{ invalid", "utf8");
  assert.equal((await scrapeUndark.__scrapeUndarkTest.readVisited(visitedPath)).urls.length, 0);
  await writeFile(visitedPath, "{}", "utf8");
  assert.equal((await scrapeUndark.__scrapeUndarkTest.readVisited(visitedPath)).urls.length, 0);
  assert.equal(scrapeUndark.__scrapeUndarkTest.visitedSet(writtenRecord).size, 1);

  prismaFindManyImpl = async (args) =>
    args.select?.sourceUrl
      ? [{ sourceUrl: "https://undark.org/2026/01/existing" }]
      : [];
  discoverImpl = async () => [
    "https://undark.org/2026/01/existing",
    "https://undark.org/2026/01/save",
    "https://undark.org/2026/01/duplicate",
    "https://undark.org/2026/01/fail",
  ];
  scrapeAndSaveImpl = async (url) => {
    if (url.includes("duplicate"))
      return { status: "skipped", reason: "duplicate sourceUrl", sourceUrl: url };
    if (url.includes("fail"))
      return { status: "failed", reason: "extract failed", sourceUrl: url };
    return savedOutcome(url, "Undark");
  };
  const scrapeRecord = { version: 1, provider: "undark", updatedAt: "", urls: [] };
  const scrapeResult = await scrapeUndark.__scrapeUndarkTest.scrapeFreshUndark(
    providerByKey.get("undark"),
    2,
    2,
    scrapeRecord,
    false,
    false,
    true,
    true,
  );
  assert.equal(scrapeResult.discovered, 4);
  assert.equal(scrapeResult.outcomes.length, 3);
  assert.equal(prismaUpdateCalls.length, 1);
  assert.equal(recordCrawlCalls.at(-1)?.key, "undark");

  prismaFindManyImpl = async () => [];
  discoverImpl = async () => [
    "https://undark.org/2026/01/seq-one",
    "https://undark.org/2026/01/seq-two",
  ];
  scrapeAndSaveImpl = async (url) => savedOutcome(url, "Undark");
  const sequentialResult = await scrapeUndark.__scrapeUndarkTest.scrapeFreshUndark(
    providerByKey.get("undark"),
    1,
    1,
    { version: 1, provider: "undark", updatedAt: "", urls: [] },
    false,
    true,
    false,
    false,
  );
  assert.equal(sequentialResult.outcomes.length, 1);
  assert.match(scrapeUndark.__scrapeUndarkTest.continueCommand(scrapeUndark.parseArgs(["--draft"])), /--draft/);

  prismaFindManyImpl = async () => [];
  assert.equal((await scrapeUndark.__scrapeUndarkTest.analyzeUndarkFromDb()).length, 0);
  prismaFindManyImpl = async (args) =>
    args.select?.title
      ? [
          {
            title: "One",
            sourceUrl: "https://undark.org/a",
            content: "<p>Undark is a non-profit, editorially independent magazine.</p>",
            wordCount: 10,
          },
          {
            title: "Two",
            sourceUrl: "https://undark.org/b",
            content: "<p>Undark is a non-profit, editorially independent magazine.</p>",
            wordCount: 10,
          },
        ]
      : [{ sourceUrl: "https://undark.org/a" }, { sourceUrl: "https://undark.org/a#x" }];
  assert.ok((await scrapeUndark.__scrapeUndarkTest.analyzeUndarkFromDb()).length > 0);
  assert.equal(
    scrapeUndark.analyzeArticles([
      { title: "Plain", sourceUrl: null, content: "Plain fallback text.", wordCount: 3 },
    ]).length,
    0,
  );
  assert.ok(
    scrapeUndark.analyzeArticles([
      {
        title: "One",
        sourceUrl: "https://undark.org/one",
        content:
          "<p>Undark is a non-profit, editorially independent magazine.</p><p>Sign up for our newsletter.</p>",
        wordCount: 10,
      },
      {
        title: "Two",
        sourceUrl: "https://undark.org/two",
        content:
          "<p>Undark is a non-profit, editorially independent magazine.</p><p>Sign up for our newsletter.</p><p>Sign up for our newsletter.</p>",
        wordCount: 10,
      },
    ]).length >= 2,
  );
  prismaFindManyImpl = async (args) =>
    args.select?.title
      ? [
          {
            title: "Clean",
            sourceUrl: "https://undark.org/clean",
            content: "<p>Clean synthetic article body.</p>",
            wordCount: 5,
          },
        ]
      : [];
  assert.equal((await scrapeUndark.__scrapeUndarkTest.analyzeUndarkFromDb()).length, 0);

  const counts = [5, 4, 1, 0];
  prismaCountImpl = async () => counts.shift() ?? 0;
  prismaFindManyImpl = async (args) =>
    args.select?.sourceUrl
      ? [{ sourceUrl: "https://undark.org/a" }, { sourceUrl: "https://undark.org/a#x" }]
      : [];
  const dbCounts = await scrapeUndark.__scrapeUndarkTest.providerDbCounts("Undark");
  assert.equal(dbCounts.duplicateGroups, 1);

  const publishCounts = [6, 6, 0, 0];
  prismaCountImpl = async () => publishCounts.shift() ?? 0;
  prismaUpdateManyImpl = async () => ({ count: 2 });
  assert.equal((await scrapeUndark.__scrapeUndarkTest.publishUndarkArticles()).published, 6);

  assert.equal(await scrapeUndark.__scrapeUndarkTest.main(["--help"]), 0);

  await resetStateRoot();
  prismaFindManyImpl = async (args) => {
    if (args.select?.title) return [];
    return [];
  };
  let mainCounts = [1, 1, 0, 0, 1, 1, 0, 0, 2, 2, 0, 0];
  prismaCountImpl = async () => mainCounts.shift() ?? 0;
  discoverImpl = async () => ["https://undark.org/2026/01/main"];
  scrapeAndSaveImpl = async (url) => savedOutcome(url, "Undark");
  const mainCode = await scrapeUndark.__scrapeUndarkTest.main([
    "--limit",
    "1",
    "--concurrency",
    "1",
    "--visited-file",
    path.relative(process.cwd(), statePath("undark-main.json")),
  ]);
  assert.equal(mainCode, 0);
  assert.equal((await readFile(statePath("undark-main.json"), "utf8")).includes("undark"), true);

  mainCounts = [0, 0, 0, 0, 0, 0, 0, 0];
  assert.equal(
    await scrapeUndark.__scrapeUndarkTest.main([
      "--analyze-only",
      "--draft",
      "--visited-file",
      path.relative(process.cwd(), statePath("undark-analyze.json")),
    ]),
    0,
  );

  mainCounts = [1, 1, 0, 0, 1, 1, 0, 0];
  discoverImpl = async () => ["https://undark.org/2026/01/all-done"];
  scrapeAndSaveImpl = async (url) => savedOutcome(url, "Undark");
  assert.equal(
    await scrapeUndark.__scrapeUndarkTest.main([
      "--all",
      "--draft",
      "--visited-file",
      path.relative(process.cwd(), statePath("undark-all.json")),
    ]),
    0,
  );
});

test("scrape-smithsonian covers state, discovery, scrape, DB, publish, and main paths", async (t) => {
  const consoleCapture = captureConsole(t);
  await resetStateRoot();
  const visitedPath = statePath("smithsonian-visited.json");
  assert.equal(scrapeSmithsonian.parseArgs(["--since-year", "bad", "--bad"]).sinceYear, null);
  assert.match(consoleCapture.warns.join("\n"), /Unknown flag: --bad/);
  assert.throws(
    () => scrapeSmithsonian.__scrapeSmithsonianTest.resolveRepoLocalPath("../outside.json"),
    /inside the repository/,
  );
  assert.equal(scrapeSmithsonian.__scrapeSmithsonianTest.normalizeUrl("not a url"), null);
  assert.equal(scrapeSmithsonian.__scrapeSmithsonianTest.isVisitedRecord({}), false);
  assert.equal((await scrapeSmithsonian.__scrapeSmithsonianTest.readVisited(visitedPath)).urls.length, 0);

  const record = await scrapeSmithsonian.__scrapeSmithsonianTest.readVisited(visitedPath);
  scrapeSmithsonian.__scrapeSmithsonianTest.markVisited(
    record,
    "https://www.smithsonianmag.com/history/seen-180000001/#comments",
    "saved",
  );
  scrapeSmithsonian.__scrapeSmithsonianTest.markVisited(
    record,
    "https://www.smithsonianmag.com/history/seen-180000001/",
    "duplicate",
  );
  scrapeSmithsonian.__scrapeSmithsonianTest.markVisited(record, "not a url", "failed");
  await scrapeSmithsonian.__scrapeSmithsonianTest.writeVisited(visitedPath, record);
  assert.equal(
    (await scrapeSmithsonian.__scrapeSmithsonianTest.readVisited(visitedPath)).urls.length,
    1,
  );
  await writeFile(visitedPath, "{\"version\":2}", "utf8");
  assert.equal((await scrapeSmithsonian.__scrapeSmithsonianTest.readVisited(visitedPath)).urls.length, 0);

  discoverImpl = async () => [
    "https://www.smithsonianmag.com/history/seen-180000001/",
    "https://www.smithsonianmag.com/history/save-180000002/",
    "https://www.smithsonianmag.com/history/duplicate-180000003/",
    "https://www.smithsonianmag.com/history/fail-180000004/",
  ];
  findExistingImpl = async (urls) =>
    new Set(urls.filter((url) => url.includes("seen")));
  scrapeAndSaveImpl = async (url) => {
    if (url.includes("duplicate"))
      return { status: "skipped", reason: "duplicate sourceUrl", sourceUrl: url };
    if (url.includes("fail"))
      return { status: "failed", reason: "quality failed", sourceUrl: url };
    return savedOutcome(url, "Smithsonian Magazine");
  };
  const scrapeResult = await scrapeSmithsonian.__scrapeSmithsonianTest.scrapeFreshSmithsonian(
    providerByKey.get("smithsonian"),
    3,
    { version: 1, provider: "smithsonian", updatedAt: "", urls: [] },
    false,
    false,
    true,
  );
  assert.equal(scrapeResult.outcomes.length, 3);
  assert.equal(recordCrawlCalls.at(-1)?.key, "smithsonian");

  discoverImpl = async () => [
    "https://www.smithsonianmag.com/history/target-one-180000005/",
    "https://www.smithsonianmag.com/history/target-two-180000006/",
  ];
  findExistingImpl = async () => new Set();
  scrapeAndSaveImpl = async (url) => savedOutcome(url, "Smithsonian Magazine");
  const targetSaved = await scrapeSmithsonian.__scrapeSmithsonianTest.scrapeFreshSmithsonian(
    providerByKey.get("smithsonian"),
    1,
    { version: 1, provider: "smithsonian", updatedAt: "", urls: [] },
    false,
    true,
    false,
  );
  assert.equal(targetSaved.outcomes.length, 1);

  discoverImpl = async () => [
    "https://www.smithsonianmag.com/history/existing-180000008/",
  ];
  findExistingImpl = async (urls) => new Set(urls);
  const noneSelected = await scrapeSmithsonian.__scrapeSmithsonianTest.scrapeFreshSmithsonian(
    providerByKey.get("smithsonian"),
    1,
    { version: 1, provider: "smithsonian", updatedAt: "", urls: [] },
    false,
    false,
    false,
  );
  assert.equal(noneSelected.outcomes.length, 0);

  prismaFindManyImpl = async () => [];
  assert.equal((await scrapeSmithsonian.__scrapeSmithsonianTest.analyzeSmithsonianFromDb()).length, 0);
  prismaFindManyImpl = async (args) =>
    args.select?.title
      ? [
          {
            title: "Clean",
            sourceUrl: "https://www.smithsonianmag.com/clean",
            content: "<p>Clean synthetic article body.</p>",
            wordCount: 5,
          },
        ]
      : [];
  assert.equal((await scrapeSmithsonian.__scrapeSmithsonianTest.analyzeSmithsonianFromDb()).length, 0);
  prismaFindManyImpl = async (args) =>
    args.select?.title
      ? [
          {
            title: "One",
            sourceUrl: "https://www.smithsonianmag.com/a",
            content: "<p>Sign up for our newsletter to get the latest stories.</p>",
            wordCount: 10,
          },
          {
            title: "Two",
            sourceUrl: "https://www.smithsonianmag.com/b",
            content: "<p>Sign up for our newsletter to get the latest stories.</p>",
            wordCount: 10,
          },
        ]
      : [];
  assert.ok((await scrapeSmithsonian.__scrapeSmithsonianTest.analyzeSmithsonianFromDb()).length > 0);
  assert.equal(
    scrapeSmithsonian.analyzeArticles([
      {
        title: "Plain",
        sourceUrl: null,
        content: "Sign up for our newsletter to get the latest stories.",
        wordCount: 8,
      },
      {
        title: "Plain two",
        sourceUrl: "https://www.smithsonianmag.com/plain-two",
        content: "Sign up for our newsletter to get the latest stories.",
        wordCount: 8,
      },
    ]).length > 0,
    true,
  );
  assert.equal(scrapeSmithsonian.__scrapeSmithsonianTest.truncate("a ".repeat(100), 10).endsWith("…"), true);

  const counts = [4, 3, 1, 0];
  prismaCountImpl = async () => counts.shift() ?? 0;
  assert.equal((await scrapeSmithsonian.__scrapeSmithsonianTest.smithsonianDbCounts()).total, 4);

  const publishCounts = [5, 5, 0, 0];
  prismaCountImpl = async () => publishCounts.shift() ?? 0;
  prismaUpdateManyImpl = async () => ({ count: 1 });
  assert.equal((await scrapeSmithsonian.__scrapeSmithsonianTest.publishSmithsonianArticles()).published, 5);

  assert.equal(await scrapeSmithsonian.__scrapeSmithsonianTest.main(["--help"]), 0);

  await resetStateRoot();
  prismaFindManyImpl = async () => [];
  let mainCounts = [1, 1, 0, 0];
  prismaCountImpl = async () => mainCounts.shift() ?? 0;
  discoverImpl = async () => [
    "https://www.smithsonianmag.com/history/main-180000007/",
  ];
  scrapeAndSaveImpl = async (url) => savedOutcome(url, "Smithsonian Magazine");
  const mainCode = await scrapeSmithsonian.__scrapeSmithsonianTest.main([
    "--limit",
    "1",
    "--visited-file",
    path.relative(process.cwd(), statePath("smithsonian-main.json")),
    "--publish",
    "--since-year",
    "2012",
    "--exclude-section",
    "smart-news,travel",
    "--category-visible-only",
    "--all",
  ]);
  assert.equal(mainCode, 0);
  assert.deepEqual(smithsonianProviderConfigs[0], {
    sinceYear: 2012,
    excludeSections: ["smart-news", "travel"],
    includeCategoryArchives: true,
    categoryVisibleOnly: true,
  });
  assert.equal(
    (await readFile(statePath("smithsonian-main.json"), "utf8")).includes("smithsonian"),
    true,
  );
});
