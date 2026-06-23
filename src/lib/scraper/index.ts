import { prisma } from "@/lib/prisma";
import { ArticleStatus, Prisma } from "@prisma/client";
import type { Provider, ScrapedArticle } from "@/lib/scraper/types";
import { extractArticle, fetchHtml } from "@/lib/scraper/extract";
import { providerForUrl } from "@/lib/scraper/providers";
import { isProviderEnabled } from "@/lib/content-sources";
import { isUrlAllowed } from "@/lib/scraper/robots";
import { PUBLIC_ARTICLE_CREATE_FIELDS, findPublicLibraryArticleBySourceUrl } from "@/lib/article-access";
import { recordAuditFromRequest, type AuditRequestInput } from "@/lib/audit";

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
    if (providerForUrl(abs)?.key !== provider.key) continue;
    if (!provider.articleUrlPattern.test(abs)) continue;
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
};

/**
 * Crawls a provider's seed pages, collecting up to `limit` article URLs. Honors
 * content-source governance: a DISABLED provider yields nothing, and every seed
 * + discovered link is filtered through the robots.txt allow check (fail-open).
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

  const collected = new Set<string>();
  for (const seed of provider.seeds) {
    if (collected.size >= limit) break;
    if (!(await allowedCheck(seed))) continue; // robots-disallowed seed
    let html: string;
    try {
      html = await fetchPage(seed);
    } catch {
      continue;
    }
    for (const link of discoverLinks(provider, html, seed)) {
      if (collected.size >= limit) break;
      if (!(await allowedCheck(link))) continue; // robots-disallowed article
      collected.add(link);
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
