/**
 * Shared category-mapping and URL-filter helpers used by provider modules.
 *
 * Centralizing these utilities means individual provider files only express
 * their own rules; they never duplicate the regex-matching plumbing.
 */
import { CATEGORY_SLUGS } from "@/lib/categories";
import { parseRssUrls } from "@/lib/scraper/rss";
import type { UrlExtractorContext } from "@/lib/scraper/types";

/**
 * Builds a {@link Provider.urlExtractor} that discovers article URLs from one
 * or more RSS 2.0 / Atom feeds. Each feed is fetched via the injected
 * `ctx.fetch` (so tests stay network-free), parsed with {@link parseRssUrls},
 * and the results are deduplicated across feeds.
 *
 * Feeds are fetched in order until roughly `2 × limit` candidates are
 * collected (discovery enforces the hard `limit` after pattern/filter/robots
 * validation). A feed that throws or returns nothing is skipped gracefully so
 * one unreachable feed never aborts discovery.
 *
 * Returned URLs are raw candidates — `discoverProviderUrls` still validates
 * each against the provider's hostname, `articleUrlPattern`, `articleUrlFilter`
 * and robots rules.
 */
export function rssUrlExtractor(
  feedUrls: readonly string[],
): (ctx: UrlExtractorContext) => Promise<string[]> {
  const feeds = [...new Set(feedUrls)];
  return async ({ limit, fetch: fetchFn }) => {
    const seen = new Set<string>();
    const urls: string[] = [];
    for (const feedUrl of feeds) {
      if (urls.length >= limit * 2) break;
      try {
        const xml = await fetchFn(feedUrl);
        for (const url of parseRssUrls(xml)) {
          if (!seen.has(url)) {
            seen.add(url);
            urls.push(url);
          }
        }
      } catch {
        // graceful degradation — a single feed failure doesn't stop discovery
      }
    }
    return urls;
  };
}

/**
 * Maps a free-form section/topic string (from a URL path or article metadata)
 * onto one of our canonical category slugs. Returns null when nothing matches.
 */
export function mapSectionToCategory(section: string | null): string | null {
  if (!section) return null;
  const s = section.toLowerCase();

  const rules: Array<[RegExp, string]> = [
    // Science is checked FIRST so biology/mind/"science-nature" sections beat the
    // broad `world` ("living world") and `environment` ("science & nature") rules.
    [/\b((?<!social[\s.-])science|living.?world|the.?mind|\bmind\b|biolog|zoolog|paleontolog|psycholog|neuroscience|astronom|astrophysic|physic|chemist|\bmath|mathematic|genetic|cosmos|space|geolog|quantum)/, "science"],
    [/\b(world|global|international|asia|europe|africa|americas|middle.?east)/, "world"],
    [/\b(politic|election|congress|white.?house|government|policy)/, "politics"],
    [/\b(business|money|econom|market|finance|deal|compan|industr)/, "business"],
    [/\b(health|wellness|coronavirus|covid|medic|fitness|disease)/, "health"],
    [/\b(idea|philosoph|essay|opinion|ethic|consciousness|metaphysic|existential|the-?conversation)/, "ideas"],
    [/\b(histor|archaeolog|ancient|medieval|heritage|civil.?war|antiquit)/, "history"],
    [/\b(travel|destination|tourism|vacation|expedition|journey)/, "travel"],
    [/\b(environment|climate|sustainab|conservation|wildlife|animal|ecolog|biodiversit|pollution|carbon|emission|nature|wild|ocean|planet|earth)/, "environment"],
    [/\b(tech|gadget|software|hardware|\bai\b|artificial.?intelligence|innovation|computing|robotic|internet|digital)/, "tech"],
    [/\b(sport|nfl|nba|mlb|soccer|football|olympic)/, "sports"],
    [/\b(culture|art|book|style|food|fashion|design|\bsociety\b|social.?science)/, "culture"],
    [/\b(entertainment|celebrit|tv|television|movie|film|music|hollywood|gaming|game)/, "entertainment"],
  ];

  for (const [pattern, slug] of rules) {
    if (pattern.test(s) && CATEGORY_SLUGS.includes(slug)) {
      return slug;
    }
  }
  return null;
}

/** Picks the first non-empty path segment of a URL (e.g. "/health/foo" → "health"). */
function firstSegment(url: URL): string | null {
  const segments = url.pathname.split("/").filter(Boolean);
  return segments[0] ?? null;
}

/** Derives a category from the first path segment, falling back through section metadata. */
export const categoryFromFirstSegment = (url: URL, section: string | null): string | null =>
  mapSectionToCategory(section) ?? mapSectionToCategory(firstSegment(url));

/**
 * Evaluates a provider's category rules against the URL path + section string.
 * Falls back to `categoryFromFirstSegment` then `fallback` when no rule fires.
 */
export function categoryFromRules(
  url: URL,
  section: string | null,
  rules: ReadonlyArray<readonly [RegExp, string]>,
  fallback: string | null,
): string | null {
  const haystack = `${section ?? ""} ${url.pathname}`.toLowerCase();
  for (const [pattern, slug] of rules) {
    if (pattern.test(haystack) && CATEGORY_SLUGS.includes(slug)) return slug;
  }
  return categoryFromFirstSegment(url, section) ?? fallback;
}

/**
 * Like {@link categoryFromRules} but returns `null` when no rule matches —
 * letting the extract pipeline fall through to `mapSectionToCategory` and the
 * provider's `defaultCategory`. Used by providers with idiosyncratic section
 * labels where some labels (e.g. newsletter formats) should NOT force a slug.
 */
export function lookupSection(
  url: URL,
  section: string | null,
  rules: ReadonlyArray<readonly [RegExp, string]>,
): string | null {
  const haystack = `${section ?? ""} ${url.pathname}`.toLowerCase();
  for (const [pattern, slug] of rules) {
    if (pattern.test(haystack) && CATEGORY_SLUGS.includes(slug)) return slug;
  }
  return null;
}

/**
 * Returns true when `url` does NOT contain any of the given `fragments`.
 * Used in `articleUrlFilter` to exclude live-blogs, video pages, etc.
 */
export function excludes(url: string, fragments: readonly string[]): boolean {
  const lower = url.toLowerCase();
  return !fragments.some((fragment) => lower.includes(fragment));
}
