import net from "node:net";

import { assertSafeHostname, assertSafeUrl, isPrivateAddress, SsrfError } from "@/lib/scraper/ssrf";

type Browser = {
  newContext(options: BrowserContextOptions): Promise<BrowserContext>;
  close(): Promise<void>;
  on(event: "disconnected", listener: () => void): void;
};

type BrowserContext = {
  route(pattern: string, handler: (route: Route) => Promise<void> | void): Promise<void>;
  newPage(): Promise<Page>;
  close(): Promise<void>;
};

type BrowserContextOptions = {
  userAgent: string;
  locale: string;
  viewport: { width: number; height: number };
};

type Page = {
  goto(
    url: string,
    options: { waitUntil: "domcontentloaded"; timeout: number },
  ): Promise<ResponseLike | null>;
  content(): Promise<string>;
  waitForTimeout(ms: number): Promise<void>;
};

type ResponseLike = {
  status(): number;
};

type Route = {
  request(): RequestLike;
  abort(): Promise<void>;
  continue(): Promise<void>;
};

type RequestLike = {
  url(): string;
  resourceType(): string;
};

const DESKTOP_CHROME_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const BLOCKED_RESOURCE_TYPES = new Set(["image", "media", "font", "stylesheet"]);
const CHALLENGE_MARKERS = ["just a moment", "cf-mitigated", "checking your browser"];
const CHALLENGE_POLL_INTERVAL_MS = 500;
const MAX_CHALLENGE_WAIT_MS = 15_000;

let browserPromise: Promise<Browser> | null = null;

function browserContextOptions(): BrowserContextOptions {
  return {
    userAgent: DESKTOP_CHROME_UA,
    locale: "en-US",
    viewport: { width: 1365, height: 900 },
  };
}

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = (async () => {
      const { chromium } = await import("playwright");
      const browser = await chromium.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-dev-shm-usage"],
      });
      browser.on("disconnected", () => {
        browserPromise = null;
      });
      return browser as unknown as Browser;
    })().catch((err) => {
      browserPromise = null;
      throw err;
    });
  }
  return browserPromise;
}

function looksLikeBrowserChallenge(html: string): boolean {
  const lower = html.toLowerCase();
  return CHALLENGE_MARKERS.some((marker) => lower.includes(marker));
}

function isHttpProtocol(protocol: string): boolean {
  return protocol === "http:" || protocol === "https:";
}

async function assertRouteSafe(rawUrl: string): Promise<void> {
  const parsed = new URL(rawUrl);
  if (!isHttpProtocol(parsed.protocol)) {
    throw new SsrfError("unsupported_protocol", rawUrl);
  }
  if (net.isIP(parsed.hostname) && isPrivateAddress(parsed.hostname)) {
    throw new SsrfError("private_address", rawUrl);
  }
  await assertSafeHostname(parsed.hostname, rawUrl);
}

async function handleRoute(route: Route): Promise<void> {
  const req = route.request();
  const reqUrl = req.url();
  try {
    const parsed = new URL(reqUrl);
    if (!isHttpProtocol(parsed.protocol)) {
      await route.abort();
      return;
    }
    if (BLOCKED_RESOURCE_TYPES.has(req.resourceType())) {
      await route.abort();
      return;
    }
    await assertRouteSafe(reqUrl);
    await route.continue();
  } catch {
    await route.abort();
  }
}

function challengeDeadline(timeoutMs: number): number {
  const challengeBudgetMs = Math.max(0, Math.min(timeoutMs, MAX_CHALLENGE_WAIT_MS));
  return Date.now() + challengeBudgetMs;
}

async function waitThroughBrowserChallenge(page: Page, initialHtml: string, deadline: number): Promise<string> {
  let html = initialHtml;
  while (looksLikeBrowserChallenge(html) && Date.now() < deadline) {
    const waitMs = Math.min(CHALLENGE_POLL_INTERVAL_MS, Math.max(0, deadline - Date.now()));
    await page.waitForTimeout(waitMs);
    html = await page.content();
  }
  return html;
}

export async function renderViaBrowser(
  url: string,
  timeoutMs: number,
): Promise<{ status: number; html: string }> {
  await assertSafeUrl(url);
  const browser = await getBrowser();
  const context = await browser.newContext(browserContextOptions());

  try {
    await context.route("**/*", handleRoute);

    const page = await context.newPage();
    const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    const status = resp?.status() ?? 0;
    const deadline = challengeDeadline(timeoutMs);
    const html = await waitThroughBrowserChallenge(page, await page.content(), deadline);

    return { status, html };
  } finally {
    await context.close();
  }
}

export async function closeBrowser(): Promise<void> {
  if (!browserPromise) return;
  const current = browserPromise;
  browserPromise = null;
  let browser: Browser | null = null;
  try {
    browser = await current;
  } catch {
    return;
  }
  await browser.close();
}
