import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { fetchText } from "@/lib/scraper/fetch";
import { scraperTimeoutMs } from "@/lib/scraper/limits";
import { assertSafeUrl } from "@/lib/scraper/ssrf";
import undark from "./undark";

const UNDARK_WORDPRESS_POST_API =
  "https://public-api.wordpress.com/rest/v1.1/sites/undark.org/posts/";
const DEFAULT_RENDER_TIMEOUT_MS = Math.max(scraperTimeoutMs(), 30_000);
const DEFAULT_CHROMIUM_EXECUTABLE = path.join(
  homedir(),
  ".cache/ms-playwright/chromium-1228/chrome-linux64/chrome",
);
const PLAYWRIGHT_INSTALL_HINT =
  "Run `npx playwright install chromium` or set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH.";

export class UndarkHeadlessUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UndarkHeadlessUnavailableError";
  }
}

export type FetchUndarkHeadlessOptions = {
  timeoutMs?: number;
};

type WordPressPostResponse = {
  URL?: unknown;
  title?: unknown;
  content?: unknown;
  author?: unknown;
  date?: unknown;
  excerpt?: unknown;
  featured_image?: unknown;
  categories?: unknown;
};

export type UndarkPostFetch = (url: string) => Promise<string>;

export function isUndarkArticleUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }

  return (
    url.protocol === "https:" &&
    undark.hostnames.includes(url.hostname.toLowerCase()) &&
    undark.articleUrlPattern.test(url.href) &&
    (undark.articleUrlFilter?.(url.href) ?? true)
  );
}

function assertUndarkArticleUrl(url: string): void {
  if (!isUndarkArticleUrl(url)) {
    throw new Error(`Headless Undark scraping only accepts validated Undark article URLs: ${url}`);
  }
}

function apiSlugForArticle(url: string): string {
  const parsed = new URL(url);
  if (parsed.hostname === "race.undark.org") {
    throw new Error("Undark WordPress API fallback does not support race.undark.org articles.");
  }
  const slug = parsed.pathname.split("/").filter(Boolean).at(-1);
  if (!slug) throw new Error(`Cannot derive Undark WordPress slug for ${url}`);
  return slug;
}

function wpString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function wpAuthorName(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  return wpString((value as { name?: unknown }).name);
}

function wpCategoryName(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  for (const category of Object.values(value as Record<string, unknown>)) {
    if (category && typeof category === "object") {
      const name = wpString((category as { name?: unknown }).name);
      if (name) return name;
    }
  }
  return null;
}

function stripHtml(input: string | null): string | null {
  if (!input) return null;
  const text = input
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > 0 ? text : null;
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function metaTag(name: string, value: string | null, attr = "name"): string {
  return value ? `<meta ${attr}="${escapeHtml(name)}" content="${escapeHtml(value)}">` : "";
}

export async function fetchUndarkArticleHtmlFromWordPressApi(
  sourceUrl: string,
  fetcher: UndarkPostFetch = fetchText,
): Promise<string> {
  assertUndarkArticleUrl(sourceUrl);
  await assertSafeUrl(sourceUrl);
  const apiUrl = new URL(`${UNDARK_WORDPRESS_POST_API}slug:${encodeURIComponent(apiSlugForArticle(sourceUrl))}`);
  apiUrl.searchParams.set(
    "fields",
    "URL,title,content,author,date,excerpt,featured_image,categories",
  );

  const parsed = JSON.parse(await fetcher(apiUrl.href)) as WordPressPostResponse;
  const canonicalUrl = wpString(parsed.URL) ?? sourceUrl;
  if (!isUndarkArticleUrl(canonicalUrl)) {
    throw new Error("Undark WordPress API returned a non-article URL.");
  }

  const content = wpString(parsed.content);
  const title = stripHtml(wpString(parsed.title));
  if (!content || !title) {
    throw new Error("Undark WordPress API returned incomplete article content.");
  }

  const author = wpAuthorName(parsed.author);
  const excerpt = stripHtml(wpString(parsed.excerpt));
  const publishedAt = wpString(parsed.date);
  const heroImage = wpString(parsed.featured_image);
  const section = wpCategoryName(parsed.categories);
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    headline: title,
    ...(author ? { author: { "@type": "Person", name: author } } : {}),
    ...(publishedAt ? { datePublished: publishedAt } : {}),
    ...(heroImage ? { image: heroImage } : {}),
    ...(excerpt ? { description: excerpt } : {}),
    ...(section ? { articleSection: section } : {}),
  };

  return `<!doctype html>
<html>
<head>
  <title>${escapeHtml(title)}</title>
  ${metaTag("og:title", title, "property")}
  ${metaTag("author", author)}
  ${metaTag("article:published_time", publishedAt, "property")}
  ${metaTag("og:image", heroImage, "property")}
  ${metaTag("og:description", excerpt, "property")}
  ${metaTag("article:section", section, "property")}
  <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
</head>
<body>
  <article>${content}</article>
</body>
</html>`;
}

function browserExecutablePath(): string | undefined {
  const configured =
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? DEFAULT_CHROMIUM_EXECUTABLE;
  return existsSync(configured) ? configured : undefined;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function firstLine(message: string): string {
  return message.split("\n")[0]?.trim() || message;
}

function unavailableFrom(err: unknown): UndarkHeadlessUnavailableError {
  const message = errorMessage(err);
  if (/cannot find (?:package|module)|ERR_MODULE_NOT_FOUND/i.test(message)) {
    return new UndarkHeadlessUnavailableError(
      `Playwright is not installed. Run \`npm install\` first, then ${PLAYWRIGHT_INSTALL_HINT}`,
    );
  }
  return new UndarkHeadlessUnavailableError(
    `Playwright Chromium could not start. ${PLAYWRIGHT_INSTALL_HINT} Original error: ${firstLine(message)}`,
  );
}

async function loadPlaywright() {
  try {
    return await import("@playwright/test");
  } catch (err) {
    throw unavailableFrom(err);
  }
}

function isLaunchUnavailable(err: unknown): boolean {
  return /Executable doesn't exist|playwright install|Host system is missing dependencies|Failed to launch|browserType\.launch/i.test(
    errorMessage(err),
  );
}

export function undarkHeadlessErrorReason(err: unknown): string {
  if (err instanceof UndarkHeadlessUnavailableError) {
    return `headless browser unavailable: ${err.message}`;
  }
  return `headless browser failed: ${firstLine(errorMessage(err))}`;
}

export async function fetchUndarkArticleHtmlWithBrowser(
  url: string,
  options: FetchUndarkHeadlessOptions = {},
): Promise<string> {
  assertUndarkArticleUrl(url);
  await assertSafeUrl(url);
  const timeoutMs = options.timeoutMs ?? DEFAULT_RENDER_TIMEOUT_MS;
  const { chromium } = await loadPlaywright();
  const executablePath = browserExecutablePath();

  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
  try {
    try {
      browser = await chromium.launch({
        headless: true,
        ...(executablePath ? { executablePath } : {}),
        args: ["--no-sandbox", "--disable-dev-shm-usage"],
      });
    } catch (err) {
      if (isLaunchUnavailable(err)) throw unavailableFrom(err);
      throw err;
    }

    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      javaScriptEnabled: true,
      viewport: { width: 1280, height: 900 },
    });
    const page = await context.newPage();
    await page.route("**/*", async (route) => {
      const type = route.request().resourceType();
      const requestUrl = route.request().url();
      try {
        if (type === "image" || type === "font" || type === "media") {
          await route.abort();
          return;
        }
        await assertSafeUrl(requestUrl);
        await route.continue();
      } catch {
        // Abort unsafe/private URLs and ignore route races from ending navigations.
        await route.abort().catch(() => {});
      }
    });

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    await page.waitForLoadState("networkidle", { timeout: Math.min(10_000, timeoutMs) }).catch(() => {});
    await page.waitForSelector("article, main, [role='main']", {
      timeout: Math.min(5_000, timeoutMs),
    }).catch(() => {});
    return await page.content();
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}
