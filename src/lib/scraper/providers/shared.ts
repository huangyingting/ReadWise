/**
 * Shared category-mapping and URL-filter helpers used by provider modules.
 *
 * Centralizing these utilities means individual provider files only express
 * their own rules; they never duplicate the regex-matching plumbing.
 */
import { CATEGORY_SLUGS } from "@/lib/categories";

/**
 * Maps a free-form section/topic string (from a URL path or article metadata)
 * onto one of our canonical category slugs. Returns null when nothing matches.
 */
export function mapSectionToCategory(section: string | null): string | null {
  if (!section) return null;
  const s = section.toLowerCase();

  const rules: Array<[RegExp, string]> = [
    [/\b(world|global|international|asia|europe|africa|americas|middle.?east)/, "world"],
    [/\b(politic|election|congress|white.?house|government|policy)/, "politics"],
    [/\b(business|money|econom|market|finance|deal|compan|industr)/, "business"],
    [/\b(health|wellness|coronavirus|covid|medic|fitness|disease)/, "health"],
    [/\b(idea|philosoph|essay|opinion|ethic|consciousness|metaphysic|existential|the-?conversation)/, "ideas"],
    [/\b(histor|archaeolog|ancient|medieval|heritage|civil.?war|antiquit)/, "history"],
    [/\b(travel|destination|tourism|vacation|expedition|journey)/, "travel"],
    [/\b(environment|climate|sustainab|conservation|wildlife|animal|ecolog|biodiversit|pollution|carbon|emission|nature|wild|ocean|planet|earth)/, "environment"],
    [/\b(science|scien|space|astronom|physic|cosmos|biolog|geolog|chemistr|quantum)/, "science"],
    [/\b(tech|gadget|software|hardware|\bai\b|artificial.?intelligence|internet|digital)/, "tech"],
    [/\b(sport|nfl|nba|mlb|soccer|football|olympic)/, "sports"],
    [/\b(culture|art|book|style|food|fashion|design)/, "culture"],
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
 * Returns true when `url` does NOT contain any of the given `fragments`.
 * Used in `articleUrlFilter` to exclude live-blogs, video pages, etc.
 */
export function excludes(url: string, fragments: readonly string[]): boolean {
  const lower = url.toLowerCase();
  return !fragments.some((fragment) => lower.includes(fragment));
}
