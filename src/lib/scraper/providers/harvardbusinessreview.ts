import type { DiscoveredUrl, Provider, UrlExtractorResult } from "@/lib/scraper/types";
import { candidateCap, categoryFromRules, extractorResultUrl, hrefsFromHtml } from "./shared";

const HBR_BASE_URL = "https://hbr.org";
const HBR_LATEST_SERVICE = `${HBR_BASE_URL}/service/components/external-list/latest`;
const HBR_LATEST_PAGE_CONTEXT = "page.external-list.the-latest";
const HBR_LATEST_PAGE_SIZE = 8;
const HBR_ARTICLE_URL_RE =
  /^https:\/\/(?:www\.)?hbr\.org\/(?:19|20)\d{2}\/(?:0[1-9]|1[0-2])\/[a-z0-9][a-z0-9-]+\/?(?:[?#].*)?$/i;
const HBR_ARCHIVE_TOC_RE = /^\/archive-toc\/[A-Za-z0-9]+$/;
const HBR_SCRIPT_RE = /^\/resources\/js\/pages\/(?:the-latest|magazine|topic)_[a-z0-9]+\.js$/i;
const HBR_EXCLUDED_URL_FRAGMENTS = [
  "/podcast/",
  "/sponsored/",
  "/email-newsletters",
  "/subscriptions",
  "/search",
  "/topic/",
  "/topics",
  "/archive-toc",
  "/store",
  "/resources/",
  "/my-library",
];
const HBR_TOPIC_SEEDS = [
  "https://hbr.org/topic/subject/strategy",
  "https://hbr.org/topic/subject/leadership",
  "https://hbr.org/topic/subject/managing-people",
  "https://hbr.org/topic/subject/managing-yourself",
  "https://hbr.org/topic/subject/innovation",
  "https://hbr.org/topic/subject/technology-and-analytics",
  "https://hbr.org/topic/subject/ai-and-machine-learning",
  "https://hbr.org/topic/subject/business-management",
  "https://hbr.org/topic/subject/entrepreneurship",
  "https://hbr.org/topic/subject/finance-and-investing",
  "https://hbr.org/topic/subject/marketing",
  "https://hbr.org/topic/subject/customer-experience",
  "https://hbr.org/topic/subject/human-resource-management",
  "https://hbr.org/topic/subject/organizational-culture",
  "https://hbr.org/topic/subject/change-management",
  "https://hbr.org/topic/subject/environmental-sustainability",
  "https://hbr.org/topic/subject/economics",
  "https://hbr.org/topic/subject/global-strategy",
  "https://hbr.org/topic/subject/international-business",
  "https://hbr.org/topic/subject/business-and-society",
] as const;
const HBR_SEEDS = [
  `${HBR_BASE_URL}/`,
  `${HBR_BASE_URL}/the-latest`,
  `${HBR_BASE_URL}/magazine`,
  `${HBR_BASE_URL}/archive`,
  ...HBR_TOPIC_SEEDS,
] as const;
const HBR_ARCHIVE_BATCH_SIZE = 4;

function normalizeCandidateUrl(raw: string, baseUrl = HBR_BASE_URL): string | null {
  try {
    const url = new URL(raw.replace(/&amp;/g, "&"), baseUrl);
    url.hash = "";
    url.search = "";
    if (url.hostname.replace(/^www\./, "") !== "hbr.org") return null;
    return url.href;
  } catch {
    return null;
  }
}

export function isHarvardBusinessReviewArticleUrl(url: string): boolean {
  if (!HBR_ARTICLE_URL_RE.test(url)) return false;
  return !HBR_EXCLUDED_URL_FRAGMENTS.some((fragment) => url.toLowerCase().includes(fragment));
}

function discovered(
  url: string,
  source: DiscoveredUrl["source"],
  sourceUrl: string,
  publishedAt?: string,
): DiscoveredUrl | null {
  const normalized = normalizeCandidateUrl(url);
  if (!normalized || !isHarvardBusinessReviewArticleUrl(normalized)) return null;
  const parsedPublishedAt = publishedAt ? Date.parse(publishedAt) : Number.NaN;
  return {
    url: normalized,
    source,
    discoveredAt: new Date().toISOString(),
    sourceUrl,
    ...(Number.isFinite(parsedPublishedAt)
      ? { publishedAt: new Date(parsedPublishedAt).toISOString() }
      : {}),
  };
}

function addArticleCandidates(
  urls: UrlExtractorResult[],
  seen: Set<string>,
  candidates: readonly UrlExtractorResult[],
  cap: number,
  baseUrl?: string,
): number {
  let added = 0;
  for (const candidate of candidates) {
    if (urls.length >= cap) break;
    const normalized = normalizeCandidateUrl(extractorResultUrl(candidate), baseUrl);
    if (!normalized || !isHarvardBusinessReviewArticleUrl(normalized) || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    urls.push(typeof candidate === "string" ? normalized : { ...candidate, url: normalized });
    added++;
  }
  return added;
}

function archiveTocSortValue(path: string): number {
  const modern = path.match(/\/archive-toc\/BR(\d{2})(\d{2})$/i);
  if (modern?.[1] && modern[2]) return 2_000_000 + Number(modern[1]) * 100 + Number(modern[2]);
  const legacy = path.match(/\/archive-toc\/(\d+)$/);
  return legacy?.[1] ? Number(legacy[1]) : 0;
}

function sortArchiveTocsNewestFirst(paths: Iterable<string>): string[] {
  return [...new Set(paths)]
    .filter((path) => HBR_ARCHIVE_TOC_RE.test(path))
    .sort((a, b) => archiveTocSortValue(b) - archiveTocSortValue(a));
}

function extractArchiveTocPaths(text: string): string[] {
  return sortArchiveTocsNewestFirst(
    [...text.matchAll(/\/archive-toc\/[A-Za-z0-9]+/g)].map((match) => match[0] ?? ""),
  );
}

function extractPageScriptUrls(html: string): string[] {
  const srcUrls = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)]
    .map((match) => normalizeCandidateUrl(match[1] ?? ""))
    .filter((url): url is string => url != null);
  return [
    ...new Set(
      [...hrefsFromHtml(html, HBR_BASE_URL), ...srcUrls]
        .map((url) => {
          const parsed = new URL(url);
          return parsed.pathname;
        })
        .filter((path) => HBR_SCRIPT_RE.test(path))
        .map((path) => `${HBR_BASE_URL}${path}`),
    ),
  ];
}

function extractArticleLinksFromHtml(html: string, sourceUrl: string): DiscoveredUrl[] {
  const candidates = [
    ...hrefsFromHtml(html, sourceUrl),
    ...[...html.matchAll(/\bdata-url=["']([^"']+)["']/gi)].map((match) => match[1] ?? ""),
  ];
  return candidates
    .map((url) => discovered(url, "archive", sourceUrl))
    .filter((entry): entry is DiscoveredUrl => entry != null);
}

function entryString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function latestEntryUrls(entry: unknown): string[] {
  if (entry == null || typeof entry !== "object") return [];
  const value = entry as Record<string, unknown>;
  const link = value.link && typeof value.link === "object"
    ? entryString((value.link as Record<string, unknown>).href)
    : null;
  const content = value.content && typeof value.content === "object"
    ? entryString((value.content as Record<string, unknown>).src)
    : null;
  return [link, content, entryString(value.url), entryString(value.URL)].filter(
    (url): url is string => url != null,
  );
}

function parseLatestServiceEntries(json: string, sourceUrl: string): DiscoveredUrl[] {
  const parsed = JSON.parse(json) as unknown;
  if (parsed == null || typeof parsed !== "object") return [];
  const entries = (parsed as { entry?: unknown }).entry;
  if (!Array.isArray(entries)) return [];
  return entries.flatMap((entry) => {
    const publishedAt = entry != null && typeof entry === "object"
      ? entryString((entry as Record<string, unknown>).published) ?? undefined
      : undefined;
    return latestEntryUrls(entry)
      .map((url) => discovered(url, "api", sourceUrl, publishedAt))
      .filter((candidate): candidate is DiscoveredUrl => candidate != null);
  });
}

function latestServiceUrl(page: number): string {
  return `${HBR_LATEST_SERVICE}/${page}/${HBR_LATEST_PAGE_SIZE}?format=json&id=${HBR_LATEST_PAGE_CONTEXT}`;
}

async function collectLatestServiceEntries(
  urls: UrlExtractorResult[],
  seen: Set<string>,
  fetch: Parameters<NonNullable<Provider["urlExtractor"]>>[0]["fetch"],
  cap: number,
): Promise<void> {
  for (let page = 0; urls.length < cap; page++) {
    const sourceUrl = latestServiceUrl(page);
    let entries: DiscoveredUrl[];
    try {
      entries = parseLatestServiceEntries(await fetch(sourceUrl), sourceUrl);
    } catch {
      break;
    }
    if (entries.length === 0) break;
    addArticleCandidates(urls, seen, entries, cap);
    if (entries.length < HBR_LATEST_PAGE_SIZE) break;
  }
}

async function collectHtmlPage(
  urls: UrlExtractorResult[],
  seen: Set<string>,
  archivePaths: Set<string>,
  scriptUrls: Set<string>,
  pageUrl: string,
  fetch: Parameters<NonNullable<Provider["urlExtractor"]>>[0]["fetch"],
  cap: number,
): Promise<void> {
  let html: string;
  try {
    html = await fetch(pageUrl);
  } catch {
    return;
  }
  addArticleCandidates(urls, seen, extractArticleLinksFromHtml(html, pageUrl), cap, pageUrl);
  for (const archivePath of extractArchiveTocPaths(html)) archivePaths.add(archivePath);
  for (const scriptUrl of extractPageScriptUrls(html)) scriptUrls.add(scriptUrl);
}

async function collectArchivePathsFromScripts(
  scriptUrls: Iterable<string>,
  archivePaths: Set<string>,
  fetch: Parameters<NonNullable<Provider["urlExtractor"]>>[0]["fetch"],
): Promise<void> {
  for (const scriptUrl of scriptUrls) {
    try {
      for (const path of extractArchiveTocPaths(await fetch(scriptUrl))) archivePaths.add(path);
    } catch {
      // Script assets are supplementary; visible page/archive links still work.
    }
  }
}

async function collectArchivePages(
  urls: UrlExtractorResult[],
  seen: Set<string>,
  archivePaths: readonly string[],
  fetch: Parameters<NonNullable<Provider["urlExtractor"]>>[0]["fetch"],
  cap: number,
): Promise<void> {
  for (let i = 0; i < archivePaths.length && urls.length < cap; i += HBR_ARCHIVE_BATCH_SIZE) {
    const batch = archivePaths.slice(i, i + HBR_ARCHIVE_BATCH_SIZE);
    const pages = await Promise.all(
      batch.map(async (path) => {
        const sourceUrl = `${HBR_BASE_URL}${path}`;
        try {
          return { sourceUrl, html: await fetch(sourceUrl) };
        } catch {
          return null;
        }
      }),
    );
    for (const page of pages) {
      if (!page || urls.length >= cap) continue;
      addArticleCandidates(
        urls,
        seen,
        extractArticleLinksFromHtml(page.html, page.sourceUrl),
        cap,
        page.sourceUrl,
      );
    }
  }
}

async function harvardBusinessReviewUrlExtractor({
  limit,
  fetch,
}: Parameters<NonNullable<Provider["urlExtractor"]>>[0]): Promise<UrlExtractorResult[]> {
  const cap = candidateCap(limit);
  const seen = new Set<string>();
  const urls: UrlExtractorResult[] = [];
  const archivePaths = new Set<string>();
  const scriptUrls = new Set<string>();

  await collectLatestServiceEntries(urls, seen, fetch, cap);

  for (const seed of HBR_SEEDS) {
    if (urls.length >= cap) break;
    await collectHtmlPage(urls, seen, archivePaths, scriptUrls, seed, fetch, cap);
  }

  await collectArchivePathsFromScripts(scriptUrls, archivePaths, fetch);
  await collectArchivePages(urls, seen, sortArchiveTocsNewestFirst(archivePaths), fetch, cap);

  return urls;
}

const harvardbusinessreview: Provider = {
  key: "harvardbusinessreview",
  name: "Harvard Business Review",
  hostnames: ["hbr.org", "www.hbr.org"],
  seeds: [...HBR_SEEDS],
  articleUrlPattern: HBR_ARTICLE_URL_RE,
  articleUrlFilter: isHarvardBusinessReviewArticleUrl,
  defaultCategory: "business",
  categories: ["business", "ideas", "tech", "health", "environment", "culture", "politics", "world"],
  readingCategories: ["business", "ideas", "tech", "health", "environment", "culture", "politics", "world"],
  cleanup: {
    dropSelectors: ["video", "iframe", "aside"],
    dropClassKeywords: [
      "advert",
      "newsletter",
      "promo",
      "recirc",
      "related",
      "share",
      "social",
      "subscription",
    ],
    dropTextKeywords: [
      "sign up for our newsletter",
      "subscribe to our newsletter",
      "harvard business review logo",
      "save share",
    ],
  },
  categoryFor: (url, section) =>
    categoryFromRules(
      url,
      section,
      [
        [/\bai\b|artificial.?intelligence|analytics|data|technology|digital|cyber|software|platform/, "tech"],
        [/environment|sustainab|climate|energy/, "environment"],
        [/health|healthcare|medical|medicine|well.?being|burnout|stress/, "health"],
        [/culture|inclusion|diversity|gender|psychological.?safety|work.?life|communication/, "culture"],
        [/politic|policy|government|regulation|geopolitic|pro.?america/, "politics"],
        [/global|international|china|emerging.?market/, "world"],
        [/leadership|managing.?yourself|decision|uncertainty|ethics|society/, "ideas"],
        [/strategy|management|business|entrepreneur|finance|marketing|customer|operations|innovation|labor|human.?resource|performance|boards?/, "business"],
      ],
      "business",
    ),
  urlExtractor: harvardBusinessReviewUrlExtractor,
};

export default harvardbusinessreview;
