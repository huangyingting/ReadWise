import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { appendFile, mkdir, readFile } from "node:fs/promises";

import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

import { closeBrowser } from "@/lib/scraper/fetch-browser";
import { fetchHtml } from "@/lib/scraper/fetch";
import { extractArticle, stripTags } from "@/lib/scraper/extract";
import { checkContentQuality, type ContentQualityResult } from "@/lib/scraper/quality";
import { getProvider, providerForUrl } from "@/lib/scraper/providers";
import type { Provider, ScrapedArticle } from "@/lib/scraper/types";

const DEFAULT_PORT = 4317;
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_LIMIT = 50;
const DEFAULT_FEEDBACK_FILE = ".scraper-state/scrape-review-feedback.jsonl";
const MAX_FEEDBACK_CHARS = 4_000;
const MAX_REQUEST_BYTES = 64 * 1024;

type ReviewMode = "db" | "preview";
type Order = "newest" | "oldest" | "random";

export type ScrapeReviewArgs = {
  noDb: boolean;
  db: string | null;
  provider: string | null;
  urlsFile: string | null;
  urls: string[];
  discover: boolean;
  limit: number;
  sample: number | null;
  order: Order;
  host: string;
  port: number;
  feedbackFile: string | null;
  help: boolean;
};

type QualitySummary = {
  grade: ContentQualityResult["grade"];
  score: number;
  failedChecks: string[];
  signals: ContentQualityResult["signals"];
};

type ReviewItem = {
  id: string;
  mode: ReviewMode;
  articleId: string | null;
  url: string;
  title: string;
  source: string | null;
  provider: string | null;
  author: string | null;
  category: string | null;
  publishedAt: string | null;
  wordCount: number | null;
  readingMinutes: number | null;
  heroImage: string | null;
  excerpt: string | null;
  content: string;
  textPreview: string;
  quality: QualitySummary | null;
  status: "loaded" | "extracted" | "failed";
  error: string | null;
};

type FeedbackPayload = {
  itemId?: unknown;
  feedback?: unknown;
  note?: unknown;
};

type FeedbackRecord = {
  version: 1;
  reviewedAt: string;
  mode: ReviewMode;
  itemId: string;
  articleId: string | null;
  url: string;
  source: string | null;
  provider: string | null;
  feedback: string;
};

type DbArticleRow = {
  id: string;
  title: string;
  author: string | null;
  source: string | null;
  sourceUrl: string | null;
  heroImage: string | null;
  excerpt: string | null;
  content: string;
  category: string | null;
  publishedAt: Date | null;
  wordCount: number | null;
  readingMinutes: number | null;
};

export function parseArgs(argv: string[]): ScrapeReviewArgs {
  const args: ScrapeReviewArgs = {
    noDb: false,
    db: null,
    provider: null,
    urlsFile: null,
    urls: [],
    discover: false,
    limit: DEFAULT_LIMIT,
    sample: null,
    order: "newest",
    host: DEFAULT_HOST,
    port: DEFAULT_PORT,
    feedbackFile: DEFAULT_FEEDBACK_FILE,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    switch (arg) {
      case "--no-db":
        args.noDb = true;
        break;
      case "--db":
        args.db = argv[++i] ?? null;
        break;
      case "--provider":
        args.provider = argv[++i] ?? null;
        break;
      case "--urls":
      case "--file":
        args.urlsFile = argv[++i] ?? null;
        break;
      case "--url":
        if (argv[i + 1]) args.urls.push(argv[++i]!);
        break;
      case "--discover":
        args.discover = true;
        break;
      case "--limit":
        args.limit = positiveInt(argv[++i], DEFAULT_LIMIT);
        break;
      case "--sample":
        args.sample = positiveInt(argv[++i], DEFAULT_LIMIT);
        args.limit = args.sample;
        if (args.order === "newest") args.order = "random";
        break;
      case "--order":
        args.order = parseOrder(argv[++i]);
        break;
      case "--host":
        args.host = argv[++i] ?? DEFAULT_HOST;
        break;
      case "--port":
        args.port = positiveInt(argv[++i], DEFAULT_PORT);
        break;
      case "--feedback-file": {
        const value = argv[++i] ?? null;
        args.feedbackFile = value === "none" ? null : value;
        break;
      }
      case "--feedback-none":
        args.feedbackFile = null;
        break;
      case "-h":
      case "--help":
        args.help = true;
        break;
      default:
        if (arg.startsWith("-")) {
          console.warn(`Unknown flag: ${arg}`);
        } else {
          args.urls.push(arg);
        }
    }
  }

  return args;
}

export function normalizeDatabaseUrl(input: string): string {
  if (/^(file|postgres|postgresql):/i.test(input)) return input;
  const absolute = path.isAbsolute(input) ? input : path.resolve(process.cwd(), input);
  return `file:${absolute}`;
}

function isPostgresUrl(databaseUrl: string): boolean {
  return /^postgres(ql)?:/i.test(databaseUrl);
}

function createPrismaClient(databaseUrl: string): PrismaClient {
  if (isPostgresUrl(databaseUrl)) {
    const url = new URL(databaseUrl);
    const schema = url.searchParams.get("schema") ?? undefined;

    return new PrismaClient({
      adapter: new PrismaPg(databaseUrl, schema ? { schema } : undefined),
      log: ["error"],
    });
  }

  return new PrismaClient({
    adapter: new PrismaBetterSqlite3({ url: databaseUrl }),
    log: ["error"],
  });
}

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseOrder(value: string | undefined): Order {
  return value === "oldest" || value === "random" ? value : "newest";
}

function printHelp(): void {
  console.log(`ReadWise scrape review

Usage:
  npm run scrape-review -- --db prisma/natgeo-scrape.db --provider natgeo --sample 200
  npm run scrape-review -- --no-db --urls urls.txt --limit 50
  npm run scrape-review -- --no-db --provider natgeo --discover --limit 20

Modes:
  DB review      Loads already-scraped Article rows from a SQLite/Postgres DB.
  No-DB preview  Fetches/extracts URLs into memory only; article content is not persisted.

Options:
  --db <path|url>          Database file or Prisma URL for DB review.
  --provider <key>         Provider key, e.g. natgeo.
  --sample N              Random DB sample size; alias for --limit N --order random.
  --limit N               Max rows/URLs to review (default ${DEFAULT_LIMIT}).
  --order newest|oldest|random
  --no-db                 Preview mode; never writes articles to a DB.
  --urls <path>           Newline-delimited URL file for no-DB preview.
  --url <url>             Single URL for no-DB preview; may be repeated.
  --discover              Discover provider URLs for no-DB preview.
  --feedback-file <path>  JSONL text feedback output (default ${DEFAULT_FEEDBACK_FILE}; "none" disables writes).
  --host <host>           Review server host (default ${DEFAULT_HOST}).
  --port <port>           Review server port (default ${DEFAULT_PORT}).
  --help                  Show this help.`);
}

async function loadDbReviewItems(args: ScrapeReviewArgs): Promise<ReviewItem[]> {
  const provider = args.provider ? requireProvider(args.provider) : null;
  const databaseUrl = normalizeDatabaseUrl(args.db ?? process.env.DATABASE_URL ?? "file:./prisma/dev.db");
  const prisma = createPrismaClient(databaseUrl);

  try {
    const limit = args.limit;
    const where = {
      ...(provider ? { source: provider.name } : {}),
      sourceUrl: { not: null },
    };

    if (args.order === "random") {
      const rows = await prisma.article.findMany({
        where,
        select: { id: true },
      });
      const ids = shuffle(rows.map((row) => row.id)).slice(0, limit);
      return rowsToReviewItems(await fetchArticlesByIds(prisma, ids), "db", provider);
    }

    const rows = await prisma.article.findMany({
      where,
      orderBy: args.order === "oldest" ? { createdAt: "asc" } : { createdAt: "desc" },
      take: limit,
      select: articleSelect,
    });
    return rowsToReviewItems(rows, "db", provider);
  } finally {
    await prisma.$disconnect();
  }
}

const articleSelect = {
  id: true,
  title: true,
  author: true,
  source: true,
  sourceUrl: true,
  heroImage: true,
  excerpt: true,
  content: true,
  category: true,
  publishedAt: true,
  wordCount: true,
  readingMinutes: true,
} as const;

async function fetchArticlesByIds(prisma: PrismaClient, ids: string[]): Promise<DbArticleRow[]> {
  if (ids.length === 0) return [];
  const rows = await prisma.article.findMany({
    where: { id: { in: ids } },
    select: articleSelect,
  });
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids.map((id) => byId.get(id)).filter((row): row is DbArticleRow => row != null);
}

function rowsToReviewItems(
  rows: DbArticleRow[],
  mode: ReviewMode,
  fallbackProvider: Provider | null,
): ReviewItem[] {
  return rows.map((row) => {
    const url = row.sourceUrl ?? "";
    const article = dbRowToQualityInput(row, url);
    const quality = summarizeQuality(checkContentQuality(article));
    const provider = fallbackProvider ?? providerForUrl(url);
    return {
      id: row.id,
      mode,
      articleId: row.id,
      url,
      title: row.title,
      source: row.source,
      provider: provider?.key ?? null,
      author: row.author,
      category: row.category,
      publishedAt: row.publishedAt?.toISOString() ?? null,
      wordCount: row.wordCount,
      readingMinutes: row.readingMinutes,
      heroImage: row.heroImage,
      excerpt: row.excerpt,
      content: row.content,
      textPreview: previewText(row.content),
      quality,
      status: "loaded",
      error: null,
    };
  });
}

function dbRowToQualityInput(row: DbArticleRow, url: string): ScrapedArticle {
  return {
    title: row.title,
    author: row.author,
    source: row.source ?? "Unknown",
    sourceUrl: url,
    heroImage: row.heroImage,
    excerpt: row.excerpt,
    content: row.content,
    category: row.category,
    publishedAt: row.publishedAt,
    wordCount: row.wordCount ?? countWords(stripTags(row.content)),
    readingMinutes: row.readingMinutes ?? 0,
  };
}

async function loadPreviewItems(args: ScrapeReviewArgs): Promise<ReviewItem[]> {
  const urls = await collectPreviewUrls(args);
  if (urls.length === 0) {
    throw new Error("No preview URLs. Pass --urls <path>, --url <url>, positional URLs, or --discover with --provider.");
  }

  const limited = urls.slice(0, args.limit);
  const items: ReviewItem[] = [];
  for (let i = 0; i < limited.length; i++) {
    const url = limited[i]!;
    console.log(`Preview extracting ${i + 1}/${limited.length}: ${url}`);
    items.push(await previewUrl(url));
  }
  return items;
}

async function collectPreviewUrls(args: ScrapeReviewArgs): Promise<string[]> {
  const urls: string[] = [];
  if (args.urlsFile) {
    const text = await readFile(args.urlsFile, "utf8");
    urls.push(...text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
  }
  urls.push(...args.urls);

  if (args.discover) {
    const provider = requireProvider(args.provider);
    const { discoverProviderUrls } = await import("@/lib/scraper/discovery");
    const discovered = await discoverProviderUrls(provider, args.limit, {
      isProviderEnabled: async () => true,
    });
    urls.push(...discovered);
  }

  return dedupeUrls(urls);
}

async function previewUrl(url: string): Promise<ReviewItem> {
  try {
    const html = await fetchHtml(url);
    const article = extractArticle(html, url);
    if (!article) {
      return failedReviewItem(url, "could not extract article content");
    }
    const quality = summarizeQuality(checkContentQuality(article));
    const provider = providerForUrl(url);
    return {
      id: randomUUID(),
      mode: "preview",
      articleId: null,
      url,
      title: article.title,
      source: article.source,
      provider: provider?.key ?? null,
      author: article.author,
      category: article.category,
      publishedAt: article.publishedAt?.toISOString() ?? null,
      wordCount: article.wordCount,
      readingMinutes: article.readingMinutes,
      heroImage: article.heroImage,
      excerpt: article.excerpt,
      content: article.content,
      textPreview: previewText(article.content),
      quality,
      status: "extracted",
      error: null,
    };
  } catch (err) {
    return failedReviewItem(url, err instanceof Error ? err.message : String(err));
  }
}

function failedReviewItem(url: string, error: string): ReviewItem {
  const provider = providerForUrl(url);
  return {
    id: randomUUID(),
    mode: "preview",
    articleId: null,
    url,
    title: url,
    source: provider?.name ?? null,
    provider: provider?.key ?? null,
    author: null,
    category: null,
    publishedAt: null,
    wordCount: null,
    readingMinutes: null,
    heroImage: null,
    excerpt: null,
    content: "",
    textPreview: "",
    quality: null,
    status: "failed",
    error,
  };
}

function summarizeQuality(quality: ContentQualityResult): QualitySummary {
  return {
    grade: quality.grade,
    score: quality.score,
    failedChecks: quality.signals.filter((signal) => !signal.passed).map((signal) => signal.check),
    signals: quality.signals,
  };
}

function previewText(html: string): string {
  return stripTags(html).replace(/\s+/g, " ").trim().slice(0, 500);
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function requireProvider(key: string | null): Provider {
  if (!key) throw new Error("--provider is required for this mode");
  const provider = getProvider(key);
  if (!provider) throw new Error(`Unknown provider: ${key}`);
  return provider;
}

function dedupeUrls(urls: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of urls) {
    let url: string;
    try {
      url = new URL(raw).href.split("#")[0]!;
    } catch {
      console.warn(`Skipping invalid URL: ${raw}`);
      continue;
    }
    if (seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
}

function shuffle<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

async function startReviewServer(
  args: ScrapeReviewArgs,
  items: ReviewItem[],
  mode: ReviewMode,
): Promise<Server> {
  const itemById = new Map(items.map((item) => [item.id, item]));
  const feedbackFile = args.feedbackFile ? path.resolve(process.cwd(), args.feedbackFile) : null;
  if (feedbackFile) await mkdir(path.dirname(feedbackFile), { recursive: true });

  const server = createServer(async (req, res) => {
    try {
      await routeRequest(req, res, {
        args,
        items,
        itemById,
        feedbackFile,
        mode,
      });
    } catch (err) {
      console.error(err);
      sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
  });

  await new Promise<void>((resolve) => server.listen(args.port, args.host, resolve));
  const url = `http://${args.host}:${args.port}`;
  console.log(`Review server ready: ${url}`);
  console.log(`Articles loaded: ${items.length}`);
  console.log(feedbackFile ? `Feedback JSONL: ${feedbackFile}` : "Feedback persistence: disabled");

  const shutdown = async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await closeBrowser();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
  return server;
}

type RouteContext = {
  args: ScrapeReviewArgs;
  items: ReviewItem[];
  itemById: Map<string, ReviewItem>;
  feedbackFile: string | null;
  mode: ReviewMode;
};

async function routeRequest(req: IncomingMessage, res: ServerResponse, ctx: RouteContext): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${ctx.args.host}:${ctx.args.port}`);
  if (req.method === "GET" && url.pathname === "/") {
    sendHtml(res, renderPage(ctx.items, ctx));
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/articles") {
    sendJson(res, 200, { articles: ctx.items });
    return;
  }
  if (req.method === "GET" && url.pathname === "/healthz") {
    sendJson(res, 200, { ok: true, count: ctx.items.length });
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/feedback") {
    const payload = await readJsonBody(req);
    const record = validateFeedback(payload, ctx.itemById, ctx.mode);
    if (ctx.feedbackFile) {
      await appendFile(ctx.feedbackFile, `${JSON.stringify(record)}\n`, "utf8");
    }
    sendJson(res, 200, { ok: true, stored: ctx.feedbackFile != null, record });
    return;
  }
  sendJson(res, 404, { error: "not found" });
}

async function readJsonBody(req: IncomingMessage): Promise<FeedbackPayload> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.byteLength;
    if (total > MAX_REQUEST_BYTES) throw new Error("request body too large");
    chunks.push(buf);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return JSON.parse(text) as FeedbackPayload;
}

function validateFeedback(
  payload: FeedbackPayload,
  itemById: Map<string, ReviewItem>,
  mode: ReviewMode,
): FeedbackRecord {
  if (typeof payload.itemId !== "string") throw new Error("itemId is required");
  const item = itemById.get(payload.itemId);
  if (!item) throw new Error(`Unknown itemId: ${payload.itemId}`);
  const rawFeedback =
    typeof payload.feedback === "string"
      ? payload.feedback
      : typeof payload.note === "string"
        ? payload.note
        : "";
  const feedback = rawFeedback.trim().slice(0, MAX_FEEDBACK_CHARS);
  if (!feedback) throw new Error("feedback text is required");

  return {
    version: 1,
    reviewedAt: new Date().toISOString(),
    mode,
    itemId: item.id,
    articleId: item.articleId,
    url: item.url,
    source: item.source,
    provider: item.provider,
    feedback,
  };
}

function sendHtml(res: ServerResponse, html: string): void {
  res.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(html);
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(body));
}

function renderPage(items: ReviewItem[], ctx: RouteContext): string {
  const data = jsonForScript({
    articles: items,
    feedbackEnabled: ctx.feedbackFile != null,
    mode: ctx.mode,
  });
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Scrape Review</title>
  <style>
    :root { color-scheme: light dark; --border: #d0d7de; --muted: #667085; --bg: #f6f8fa; --ok: #1a7f37; }
    body { margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: var(--bg); }
    header { position: sticky; top: 0; z-index: 2; padding: 10px 16px; background: Canvas; border-bottom: 1px solid var(--border); display: flex; gap: 16px; align-items: center; }
    header h1 { font-size: 16px; margin: 0; }
    header .meta { color: var(--muted); font-size: 13px; }
    main { display: grid; grid-template-columns: minmax(260px, 330px) 1fr; min-height: calc(100vh - 49px); }
    aside { border-right: 1px solid var(--border); background: Canvas; overflow: auto; max-height: calc(100vh - 49px); }
    .item { display: block; width: 100%; padding: 10px 12px; border: 0; border-bottom: 1px solid var(--border); background: transparent; text-align: left; cursor: pointer; }
    .item:hover, .item.active { background: color-mix(in srgb, Highlight 12%, Canvas); }
    .item.done { border-left: 4px solid var(--ok); }
    .item-title { font-weight: 650; line-height: 1.25; }
    .item-meta, .article-meta, .quality { color: var(--muted); font-size: 12px; margin-top: 4px; }
    section { padding: 18px; overflow: auto; max-height: calc(100vh - 49px); }
    .panel { background: Canvas; border: 1px solid var(--border); border-radius: 12px; padding: 18px; margin-bottom: 14px; }
    .article-top { display: flex; gap: 18px; align-items: flex-start; }
    .hero { max-width: 220px; max-height: 150px; border-radius: 8px; object-fit: cover; border: 1px solid var(--border); }
    h2 { margin: 0 0 8px; font-size: 26px; line-height: 1.2; }
    .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
    button.action { border: 1px solid var(--border); border-radius: 999px; padding: 8px 12px; background: Canvas; cursor: pointer; font-weight: 650; }
    textarea { width: 100%; min-height: 72px; border: 1px solid var(--border); border-radius: 8px; padding: 8px; background: Canvas; color: CanvasText; }
    .article-body { line-height: 1.65; font-size: 18px; }
    .article-body img { max-width: 100%; height: auto; }
    .article-body figure { margin: 1.2em 0; }
    .article-body figcaption { color: var(--muted); font-size: 0.9em; }
    .failed { color: #cf222e; font-weight: 650; }
    a { color: LinkText; }
    kbd { border: 1px solid var(--border); border-bottom-width: 2px; border-radius: 4px; padding: 1px 5px; font-size: 12px; }
  </style>
</head>
<body>
  <header>
    <h1>Scrape Review</h1>
    <div class="meta" id="summary"></div>
    <div class="meta">Shortcuts: <kbd>j</kbd>/<kbd>k</kbd> navigate, <kbd>s</kbd> save feedback</div>
  </header>
  <main>
    <aside id="list"></aside>
    <section>
      <div class="panel">
        <div class="article-top">
          <div style="flex:1">
            <h2 id="title"></h2>
            <div class="article-meta" id="meta"></div>
            <div class="quality" id="quality"></div>
            <p><a id="original" href="#" target="_blank" rel="noreferrer">Open original</a></p>
          </div>
          <img id="hero" class="hero" alt="" hidden />
        </div>
        <div id="error" class="failed"></div>
        <textarea id="feedback" placeholder="Write direct feedback, e.g. footer leaked, too short, wrong article type, metadata issue"></textarea>
        <div class="actions">
          <button class="action" id="save">Save feedback</button>
          <button class="action" id="prev">Previous</button>
          <button class="action" id="next">Next</button>
        </div>
      </div>
      <article class="panel article-body" id="body"></article>
    </section>
  </main>
  <script id="review-data" type="application/json">${data}</script>
  <script>
    const data = JSON.parse(document.getElementById("review-data").textContent);
    const articles = data.articles;
    const feedbackEnabled = data.feedbackEnabled;
    const storageKey = "scrape-review-feedback";
    const state = { index: 0, feedback: JSON.parse(localStorage.getItem(storageKey) || "{}") };
    const list = document.getElementById("list");
    const summary = document.getElementById("summary");
    const title = document.getElementById("title");
    const meta = document.getElementById("meta");
    const quality = document.getElementById("quality");
    const original = document.getElementById("original");
    const hero = document.getElementById("hero");
    const error = document.getElementById("error");
    const feedback = document.getElementById("feedback");
    const body = document.getElementById("body");

    function esc(value) {
      return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
    }
    function current() { return articles[state.index]; }
    function saveFeedbackState() { localStorage.setItem(storageKey, JSON.stringify(state.feedback)); }
    function renderList() {
      list.innerHTML = articles.map((item, i) => {
        const fb = state.feedback[item.id];
        const classes = ["item", i === state.index ? "active" : "", fb ? "done" : ""].filter(Boolean).join(" ");
        return '<button class="' + classes + '" data-index="' + i + '">' +
          '<div class="item-title">' + esc(item.title || item.url) + '</div>' +
          '<div class="item-meta">' + esc([item.source, item.publishedAt?.slice(0, 10), item.wordCount ? item.wordCount + " words" : null, item.quality ? item.quality.grade + " " + item.quality.score : item.status].filter(Boolean).join(" · ")) + '</div>' +
          '</button>';
      }).join("");
      list.querySelectorAll(".item").forEach((btn) => btn.addEventListener("click", () => {
        state.index = Number(btn.dataset.index);
        render();
      }));
    }
    function render() {
      const item = current();
      const done = Object.keys(state.feedback).length;
      summary.textContent = (state.index + 1) + " / " + articles.length + " · reviewed " + done + (feedbackEnabled ? "" : " · feedback writes disabled");
      title.textContent = item.title || item.url;
      meta.textContent = [item.source, item.category, item.author, item.publishedAt?.slice(0, 10), item.wordCount ? item.wordCount + " words" : null, item.readingMinutes ? item.readingMinutes + " min" : null].filter(Boolean).join(" · ");
      quality.textContent = item.quality ? ("quality: " + item.quality.grade + " · score " + item.quality.score + (item.quality.failedChecks.length ? " · failed: " + item.quality.failedChecks.join(", ") : "")) : "";
      original.href = item.url;
      if (item.heroImage) { hero.src = item.heroImage; hero.hidden = false; } else { hero.hidden = true; hero.removeAttribute("src"); }
      error.textContent = item.error || "";
      body.innerHTML = item.content || '<p class="failed">No extracted article body. Open the original URL to inspect the failure.</p>';
      const fb = state.feedback[item.id];
      feedback.value = fb?.feedback || "";
      renderList();
    }
    async function submit() {
      const item = current();
      const text = feedback.value.trim();
      if (!text) {
        alert("Please write feedback text before saving.");
        feedback.focus();
        return;
      }
      const payload = { itemId: item.id, feedback: text };
      const res = await fetch("/api/feedback", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      if (!res.ok) {
        alert("Failed to save feedback: " + await res.text());
        return;
      }
      state.feedback[item.id] = payload;
      saveFeedbackState();
      if (state.index < articles.length - 1) state.index++;
      render();
    }
    document.getElementById("save").addEventListener("click", () => submit());
    document.getElementById("prev").addEventListener("click", () => { state.index = Math.max(0, state.index - 1); render(); });
    document.getElementById("next").addEventListener("click", () => { state.index = Math.min(articles.length - 1, state.index + 1); render(); });
    window.addEventListener("keydown", (event) => {
      if (event.target && ["TEXTAREA", "INPUT"].includes(event.target.tagName)) return;
      if (event.key === "j") { state.index = Math.min(articles.length - 1, state.index + 1); render(); }
      if (event.key === "k") { state.index = Math.max(0, state.index - 1); render(); }
      if (event.key === "s") submit();
    });
    render();
  </script>
</body>
</html>`;
}

function jsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

async function main(
  argv = process.argv.slice(2),
  overrides: {
    loadPreviewItems?: typeof loadPreviewItems;
    loadDbReviewItems?: typeof loadDbReviewItems;
    startReviewServer?: typeof startReviewServer;
    closeBrowser?: typeof closeBrowser;
  } = {},
): Promise<number> {
  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return 0;
  }
  if (args.noDb && args.db) {
    throw new Error("Use either --no-db preview mode or --db review mode, not both.");
  }

  const mode: ReviewMode = args.noDb ? "preview" : "db";
  const loadPreview = overrides.loadPreviewItems ?? loadPreviewItems;
  const loadDb = overrides.loadDbReviewItems ?? loadDbReviewItems;
  const items = mode === "preview" ? await loadPreview(args) : await loadDb(args);
  await (overrides.closeBrowser ?? closeBrowser)();
  if (items.length === 0) throw new Error("No review items loaded.");
  await (overrides.startReviewServer ?? startReviewServer)(args, items, mode);
  return 0;
}

function isMain(importMetaUrl: string): boolean {
  try {
    return fileURLToPath(importMetaUrl) === process.argv[1];
  } catch {
    return false;
  }
}

export const __scrapeReviewTest = {
  printHelp,
  positiveInt,
  parseOrder,
  startReviewServer,
  loadDbReviewItems,
  fetchArticlesByIds,
  rowsToReviewItems,
  dbRowToQualityInput,
  loadPreviewItems,
  collectPreviewUrls,
  previewUrl,
  failedReviewItem,
  summarizeQuality,
  previewText,
  countWords,
  requireProvider,
  dedupeUrls,
  shuffle,
  routeRequest,
  readJsonBody,
  validateFeedback,
  sendHtml,
  sendJson,
  renderPage,
  jsonForScript,
  main,
};

if (isMain(import.meta.url)) {
  main().catch(async (err: unknown) => {
    console.error(err);
    await closeBrowser();
    process.exit(1);
  });
}
