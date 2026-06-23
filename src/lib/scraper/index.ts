import { prisma } from "@/lib/prisma";
import { ArticleStatus, Prisma } from "@prisma/client";
import type { Provider, ScrapedArticle, UrlExtractorContext } from "@/lib/scraper/types";
import { extractArticle, fetchHtml, fetchText } from "@/lib/scraper/extract";
import { isProviderEnabled } from "@/lib/content-sources";
import { isUrlAllowed } from "@/lib/scraper/robots";
import { PUBLIC_ARTICLE_CREATE_FIELDS, findPublicLibraryArticleBySourceUrl } from "@/lib/article-access";
import { recordAuditFromRequest, type AuditRequestInput } from "@/lib/audit";
import { createLogger } from "@/lib/logger";

const log = createLogger("scraper.discover");

export type SaveOutcome =
  | { status: "saved"; id: string; article: ScrapedArticle }
  | { status: "skipped"; reason: string; sourceUrl: string }
  | { status: "failed"; reason: string; sourceUrl: string };

/** Fetches and parses a single article URL. Returns null when extraction fails. */
export async function scrapeUrl(url: string): Promise<ScrapedArticle | null> {
  const html = await fetchHtml(url);
  return extractArticle(html, url);
}

/**
 * Persists a scraped article as a `draft`, de-duplicated by `sourceUrl` (for
 * library scrapes `ownerId` is null). Never throws on a duplicate — returns a
 * `skipped` outcome instead. A concurrent writer can win the race between the
 * pre-check and the insert; the `@@unique([sourceUrl, ownerId])` constraint
 * then surfaces a Prisma P2002, which is caught and reported as `skipped`
 * (re-resolving the winner's id) rather than bubbling up as a 500.
 */
export async function saveDraftArticle(
  article: ScrapedArticle,
  audit?: (created: { id: string }) => AuditRequestInput,
): Promise<SaveOutcome> {
  const existing = await findPublicLibraryArticleBySourceUrl(article.sourceUrl);
  if (existing) {
    return { status: "skipped", reason: "duplicate sourceUrl", sourceUrl: article.sourceUrl };
  }

  try {
    const created = await prisma.$transaction(async (tx) => {
      const row = await tx.article.create({
        data: {
          title: article.title,
          author: article.author,
          source: article.source,
          sourceUrl: article.sourceUrl,
          heroImage: article.heroImage,
          excerpt: article.excerpt,
          content: article.content,
          category: article.category,
          wordCount: article.wordCount,
          readingMinutes: article.readingMinutes,
          status: ArticleStatus.DRAFT,
          ...PUBLIC_ARTICLE_CREATE_FIELDS,
          publishedAt: article.publishedAt,
        },
        select: { id: true },
      });
      if (audit) {
        await recordAuditFromRequest(audit(row), tx);
      }
      return row;
    });
    return { status: "saved", id: created.id, article };
  } catch (err) {
    // A concurrent scrape created the same (sourceUrl, ownerId) first.
    if (isUniqueConstraintError(err)) {
      return { status: "skipped", reason: "duplicate sourceUrl", sourceUrl: article.sourceUrl };
    }
    throw err;
  }
}

/** Scrapes a single URL and saves it, capturing failures as outcomes. */
export async function scrapeAndSave(url: string): Promise<SaveOutcome> {
  try {
    const article = await scrapeUrl(url);
    if (!article) {
      return { status: "failed", reason: "could not extract article content", sourceUrl: url };
    }
    return await saveDraftArticle(article);
  } catch (err) {
    return { status: "failed", reason: errorMessage(err), sourceUrl: url };
  }
}

/**
 * Returns true when `url`'s hostname (sans `www.`) is listed in the provider's
 * `hostnames`. Used in preference to `providerForUrl` (registry lookup) so that
 * synthetic / test providers not registered in `PROVIDERS` work correctly.
 */
function urlBelongsToProvider(url: string, provider: Provider): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    return provider.hostnames.some((h) => h.toLowerCase().replace(/^www\./, "") === host);
  } catch {
    return false;
  }
}

/** Extracts candidate article links from a section/landing page's HTML. */
export function discoverLinks(provider: Provider, html: string, baseUrl: string): string[] {
  const hrefs = [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["']/gi)].map((m) => m[1]);
  const seen = new Set<string>();
  const links: string[] = [];
  for (const href of hrefs) {
    let abs: string;
    try {
      abs = new URL(href, baseUrl).href.split("#")[0];
    } catch {
      continue;
    }
    if (!urlBelongsToProvider(abs, provider)) continue;
    if (!provider.articleUrlPattern.test(abs)) continue;
    if (provider.articleUrlFilter && !provider.articleUrlFilter(abs)) continue;
    if (seen.has(abs)) continue;
    seen.add(abs);
    links.push(abs);
  }
  return links;
}

/**
 * Injectable governance hooks for {@link discoverProviderUrls}. Default to the
 * real implementations; tests override them without a DB or network.
 */
export type DiscoverDeps = {
  fetchHtml?: (url: string) => Promise<string>;
  /** Gate from the ContentSource model — disabled providers discover nothing. */
  isProviderEnabled?: (providerKey: string) => Promise<boolean>;
  /** robots.txt allow check applied to every seed + candidate link. */
  isUrlAllowed?: (url: string) => Promise<boolean>;
  /**
   * Full injectable fetch for `urlExtractor` (supports GET and POST). Defaults
   * to the SSRF-safe `fetchText` from extract.ts. Inject in tests to avoid
   * any real network access.
   */
  extractorFetch?: UrlExtractorContext["fetch"];
};

/**
 * Crawls a provider's seed pages, collecting up to `limit` article URLs. Honors
 * content-source governance: a DISABLED provider yields nothing, and every seed
 * + discovered link is filtered through the robots.txt allow check (fail-open).
 *
 * When the provider defines a {@link Provider.urlExtractor}, the extractor is
 * called instead of the seed-HTML crawler. Extractor results are deduplicated,
 * hostname-validated, pattern- and filter-checked, and robots-screened before
 * being returned. Extractor errors degrade gracefully to an empty result.
 *
 * When the provider defines {@link Provider.paginateSeed} + {@link Provider.maxSeedPages},
 * the HTML crawler walks up to `maxSeedPages` paginated pages per seed,
 * stopping early when the limit is reached, pages are exhausted, or two
 * consecutive pages yield no new links.
 */
export async function discoverProviderUrls(
  provider: Provider,
  limit: number,
  deps: DiscoverDeps = {},
): Promise<string[]> {
  const fetchPage = deps.fetchHtml ?? fetchHtml;
  const enabledCheck = deps.isProviderEnabled ?? isProviderEnabled;
  const allowedCheck = deps.isUrlAllowed ?? isUrlAllowed;

  if (!(await enabledCheck(provider.key))) {
    return [];
  }

  if (provider.urlExtractor) {
    return discoverViaExtractor(provider, limit, deps, allowedCheck);
  }

  return discoverViaSeedHtml(provider, limit, fetchPage, allowedCheck);
}

/**
 * Calls the provider's `urlExtractor`, then filters + validates every
 * candidate URL through hostname match, articleUrlPattern, articleUrlFilter,
 * and robots before returning up to `limit` results.
 */
async function discoverViaExtractor(
  provider: Provider,
  limit: number,
  deps: DiscoverDeps,
  allowedCheck: (url: string) => Promise<boolean>,
): Promise<string[]> {
  const extractorFetch: UrlExtractorContext["fetch"] =
    deps.extractorFetch ??
    ((url, init) =>
      init?.method && init.method !== "GET"
        ? fetchText(url, init)
        : (deps.fetchHtml ?? fetchHtml)(url));

  let candidates: string[];
  try {
    candidates = await provider.urlExtractor!({ limit, fetch: extractorFetch });
  } catch (err) {
    log.warn("extractor.failed", {
      provider: provider.key,
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }

  const seen = new Set<string>();
  const collected: string[] = [];

  for (const raw of candidates) {
    if (collected.length >= limit) break;
    let url: string;
    try {
      url = new URL(raw).href.split("#")[0];
    } catch {
      continue;
    }
    if (seen.has(url)) continue;
    seen.add(url);
    if (!urlBelongsToProvider(url, provider)) continue;
    if (!provider.articleUrlPattern.test(url)) continue;
    if (provider.articleUrlFilter && !provider.articleUrlFilter(url)) continue;
    if (!(await allowedCheck(url))) continue;
    collected.push(url);
  }

  return collected;
}

/**
 * Crawls each seed URL (optionally across multiple paginated pages) collecting
 * article links via {@link discoverLinks}. Stops per seed after `maxSeedPages`
 * pages or two consecutive pages with no new links.
 */
async function discoverViaSeedHtml(
  provider: Provider,
  limit: number,
  fetchPage: (url: string) => Promise<string>,
  allowedCheck: (url: string) => Promise<boolean>,
): Promise<string[]> {
  const maxPages = provider.maxSeedPages ?? 1;
  const MAX_CONSECUTIVE_EMPTY = 2;
  const collected = new Set<string>();

  for (const seed of provider.seeds) {
    if (collected.size >= limit) break;
    let consecutiveEmpty = 0;

    for (let page = 1; page <= maxPages; page++) {
      if (collected.size >= limit) break;

      const pageUrl =
        page === 1 ? seed : (provider.paginateSeed?.(seed, page) ?? null);
      if (!pageUrl) break;

      if (!(await allowedCheck(pageUrl))) {
        if (page === 1) break; // seed itself disallowed — skip this seed entirely
        consecutiveEmpty++;
        if (consecutiveEmpty >= MAX_CONSECUTIVE_EMPTY) break;
        continue;
      }

      let html: string;
      try {
        html = await fetchPage(pageUrl);
      } catch {
        break;
      }

      const links = discoverLinks(provider, html, pageUrl);
      const newLinks = links.filter((l) => !collected.has(l));

      if (newLinks.length === 0) {
        consecutiveEmpty++;
        if (consecutiveEmpty >= MAX_CONSECUTIVE_EMPTY) break;
      } else {
        consecutiveEmpty = 0;
      }

      for (const link of newLinks) {
        if (collected.size >= limit) break;
        if (!(await allowedCheck(link))) continue;
        collected.add(link);
      }
    }
  }

  return [...collected].slice(0, limit);
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/** True for a Prisma unique-constraint violation (P2002). */
function isUniqueConstraintError(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}
