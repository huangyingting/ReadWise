/**
 * Provider URL discovery — completely separated from persistence/DB so tests
 * can exercise discovery with fixtures and zero network or database access.
 *
 * Every candidate URL passes through hostname, pattern, optional-filter, and
 * robots validation before being returned. No provider can bypass these checks.
 */
import type {
  DiscoveredUrl,
  DiscoveredUrlSource,
  Provider,
  UrlExtractorContext,
  UrlExtractorResult,
} from "@/lib/scraper/types";
import { fetchHtml, fetchText, fetchDiscoveryResponse } from "@/lib/scraper/fetch";
import { isProviderEnabled } from "@/lib/scraper/sources";
import { isUrlAllowed } from "@/lib/scraper/robots";
import { createLogger } from "@/lib/observability/logger";

const log = createLogger("scraper.discover");

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
   * to the SSRF-safe `fetchText` from fetch.ts. Inject in tests to avoid
   * any real network access.
   */
  extractorFetch?: UrlExtractorContext["fetch"];
  /**
   * Injectable response-metadata fetch (status/final URL/validators/Retry-After)
   * exposed to `urlExtractor` for incremental/conditional discovery. Defaults to
   * the SSRF-safe `fetchDiscoveryResponse`; shares the same safe hop loop as the
   * body-only fetch. Inject in tests to stay network-free.
   */
  fetchResponse?: UrlExtractorContext["fetchResponse"];
};

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

function canonicalUrl(raw: string, baseUrl?: string): string | null {
  try {
    const url = baseUrl === undefined ? new URL(raw) : new URL(raw, baseUrl);
    return url.href.split("#")[0];
  } catch {
    return null;
  }
}

function isProviderArticleUrl(url: string, provider: Provider): boolean {
  if (!urlBelongsToProvider(url, provider)) return false;
  if (!provider.articleUrlPattern.test(url)) return false;
  if (provider.articleUrlFilter && !provider.articleUrlFilter(url)) return false;
  return true;
}

/** Extracts candidate article links from a section/landing page's HTML. */
export function discoverLinks(provider: Provider, html: string, baseUrl: string): string[] {
  const hrefs = [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["']/gi)].map((m) => m[1]);
  const seen = new Set<string>();
  const links: string[] = [];
  for (const href of hrefs) {
    const abs = canonicalUrl(href, baseUrl);
    if (!abs) continue;
    if (!isProviderArticleUrl(abs, provider)) continue;
    if (seen.has(abs)) continue;
    seen.add(abs);
    links.push(abs);
  }
  return links;
}

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
  return (await discoverProviderUrlEntries(provider, limit, deps)).map((entry) => entry.url);
}

export async function discoverProviderUrlEntries(
  provider: Provider,
  limit: number,
  deps: DiscoverDeps = {},
): Promise<DiscoveredUrl[]> {
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
): Promise<DiscoveredUrl[]> {
  const extractorFetch: UrlExtractorContext["fetch"] =
    deps.extractorFetch ??
    ((url, init) =>
      init?.method && init.method !== "GET"
        ? fetchText(url, init)
        : (deps.fetchHtml ?? fetchHtml)(url));

  const fetchResponse: UrlExtractorContext["fetchResponse"] =
    deps.fetchResponse ?? fetchDiscoveryResponse;

  let candidates: UrlExtractorResult[];
  try {
    candidates = await provider.urlExtractor!({ limit, fetch: extractorFetch, fetchResponse });
  } catch {
    log.warn("extractor.failed", {
      provider: provider.key,
      machineReason: "provider_extractor_failed",
    });
    return [];
  }

  const seen = new Set<string>();
  const collected: DiscoveredUrl[] = [];

  for (const raw of candidates) {
    if (collected.length >= limit) break;
    const candidate = normalizeExtractorResult(raw);
    const url = canonicalUrl(candidate.url);
    if (!url) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    if (!isProviderArticleUrl(url, provider)) continue;
    if (!(await allowedCheck(url))) continue;
    collected.push(completeDiscoveredUrl({ ...candidate, url }, "unknown"));
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
): Promise<DiscoveredUrl[]> {
  const maxPages = provider.maxSeedPages ?? 1;
  const MAX_CONSECUTIVE_EMPTY = 2;
  const collected = new Map<string, DiscoveredUrl>();

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
        collected.set(link, completeDiscoveredUrl({ url: link }, "seed"));
      }
    }
  }

  return [...collected.values()].slice(0, limit);
}

function normalizeExtractorResult(raw: UrlExtractorResult): Partial<DiscoveredUrl> & { url: string } {
  return typeof raw === "string" ? { url: raw } : raw;
}

function completeDiscoveredUrl(
  entry: Partial<DiscoveredUrl> & { url: string },
  fallbackSource: DiscoveredUrlSource,
): DiscoveredUrl {
  const inferredPublishedAt = entry.publishedAt ?? inferPublishedAtFromUrl(entry.url);
  return {
    url: entry.url,
    source: entry.source ?? fallbackSource,
    discoveredAt: entry.discoveredAt ?? new Date().toISOString(),
    ...(entry.lastModified ? { lastModified: normalizeIsoDate(entry.lastModified) ?? entry.lastModified } : {}),
    ...(inferredPublishedAt ? { publishedAt: normalizeIsoDate(inferredPublishedAt) ?? inferredPublishedAt } : {}),
    ...(entry.sourceUrl ? { sourceUrl: entry.sourceUrl } : {}),
  };
}

function normalizeIsoDate(value: string): string | null {
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function inferPublishedAtFromUrl(url: string): string | undefined {
  const path = safeUrlPath(url);
  if (!path) return undefined;
  const slashDate = path.match(/\/(20\d{2})\/([01]\d)\/([0-3]\d)(?:\/|$)/);
  if (slashDate) return isoDateParts(slashDate[1], slashDate[2], slashDate[3]);
  const dashDate = path.match(/\/(20\d{2})-([01]\d)-([0-3]\d)(?:[-/]|$)/);
  if (dashDate) return isoDateParts(dashDate[1], dashDate[2], dashDate[3]);
  return undefined;
}

function safeUrlPath(url: string): string | null {
  try {
    return new URL(url).pathname;
  } catch {
    return null;
  }
}

function isoDateParts(year: string | undefined, month: string | undefined, day: string | undefined): string | undefined {
  if (!year || !month || !day) return undefined;
  const time = Date.UTC(Number(year), Number(month) - 1, Number(day));
  return Number.isFinite(time) ? new Date(time).toISOString() : undefined;
}
