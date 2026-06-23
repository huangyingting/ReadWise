/**
 * robots.txt awareness for discovery/scrape (Epic RW-E009 — RW-047).
 *
 * Before fetching a provider page the scraper asks {@link isUrlAllowed}, which
 * fetches + caches the origin's robots.txt and evaluates it for our product
 * token. The check is deliberately FAIL-OPEN: a missing/unreachable/unparseable
 * robots.txt is treated as "allowed" (the robots standard only constrains crawl
 * when an explicit Disallow matches), so governance degrades gracefully and a
 * flaky robots endpoint never halts ingestion. Per-provider crawl policy from
 * the ContentSource model can layer additional restrictions on top.
 *
 * The parser is intentionally small but standard-aware: grouped User-agent
 * records, Allow/Disallow with `*` wildcards and `$` end-anchors, longest-match
 * precedence (Allow wins ties). The pure helpers ({@link parseRobots},
 * {@link isPathAllowed}) are unit tested without any network.
 */
import { fetchHtml } from "@/lib/scraper/extract";
import { createLogger } from "@/lib/logger";

const log = createLogger("robots");

/** Our crawler's product token (matches the ReadWiseBot UA in extract.ts). */
export const ROBOTS_USER_AGENT = "ReadWiseBot";

/** robots.txt cache TTL (origin-scoped). */
const CACHE_TTL_MS = 60 * 60 * 1000;

export type RobotsRules = {
  /** Disallowed path patterns for the matched group. */
  disallow: string[];
  /** Explicitly allowed path patterns for the matched group. */
  allow: string[];
};

const EMPTY_RULES: RobotsRules = { disallow: [], allow: [] };

/**
 * Parses robots.txt and returns the rule set applying to `userAgent`. An exact
 * (case-insensitive) product-token group wins over the `*` wildcard group;
 * unknown directives are ignored. Consecutive `User-agent` lines share the next
 * directive block.
 */
export function parseRobots(text: string, userAgent: string = ROBOTS_USER_AGENT): RobotsRules {
  const ua = userAgent.toLowerCase();
  const groups = new Map<string, RobotsRules>();
  let currentAgents: string[] = [];
  let sawDirectiveSinceAgent = false;

  const ensure = (agent: string): RobotsRules => {
    let rules = groups.get(agent);
    if (!rules) {
      rules = { disallow: [], allow: [] };
      groups.set(agent, rules);
    }
    return rules;
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (field === "user-agent") {
      if (sawDirectiveSinceAgent) {
        currentAgents = [];
        sawDirectiveSinceAgent = false;
      }
      currentAgents.push(value.toLowerCase());
    } else if (field === "disallow" || field === "allow") {
      sawDirectiveSinceAgent = true;
      const agents = currentAgents.length ? currentAgents : ["*"];
      for (const agent of agents) {
        const rules = ensure(agent);
        // An empty value is a no-op rule (e.g. `Disallow:` means allow all).
        if (value) rules[field].push(value);
      }
    }
  }

  return groups.get(ua) ?? groups.get("*") ?? EMPTY_RULES;
}

/** Converts a robots path pattern (`*`, `$`) into an anchored RegExp. */
function patternToRegExp(pattern: string): RegExp {
  const hasEnd = pattern.endsWith("$");
  const core = hasEnd ? pattern.slice(0, -1) : pattern;
  const escaped = core.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}${hasEnd ? "$" : ""}`);
}

function longestMatch(patterns: string[], pathname: string): number {
  let longest = -1;
  for (const pattern of patterns) {
    if (pattern === "") continue;
    try {
      if (patternToRegExp(pattern).test(pathname) && pattern.length > longest) {
        longest = pattern.length;
      }
    } catch {
      // Ignore a malformed pattern rather than rejecting the whole file.
    }
  }
  return longest;
}

/**
 * PURE: evaluates a path against parsed rules with longest-match precedence.
 * Allow wins ties (and any equal-or-longer Allow overrides a Disallow), matching
 * the de-facto robots standard. Returns true when nothing disallows the path.
 */
export function isPathAllowed(rules: RobotsRules, pathname: string): boolean {
  const path = pathname || "/";
  const disallow = longestMatch(rules.disallow, path);
  if (disallow === -1) return true;
  const allow = longestMatch(rules.allow, path);
  return allow >= disallow;
}

type RobotsCacheEntry = { rules: RobotsRules; fetchedAt: number };
const robotsCache = new Map<string, RobotsCacheEntry>();

/** Clears the in-process robots.txt cache (used by tests). */
export function clearRobotsCache(): void {
  robotsCache.clear();
}

export type RobotsDeps = {
  /** Fetches robots.txt text (defaults to the SSRF-safe scraper fetch). */
  fetchText?: (url: string) => Promise<string>;
  userAgent?: string;
  now?: () => number;
};

async function loadRules(
  origin: string,
  userAgent: string,
  fetchText: (url: string) => Promise<string>,
  now: () => number,
): Promise<RobotsRules> {
  const cacheKey = `${origin}\n${userAgent.toLowerCase()}`;
  const cached = robotsCache.get(cacheKey);
  if (cached && now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.rules;
  }

  let rules = EMPTY_RULES;
  try {
    const text = await fetchText(`${origin}/robots.txt`);
    rules = parseRobots(text, userAgent);
  } catch (err) {
    // Fail open: no robots.txt (or fetch error) means crawling is allowed.
    log.debug("robots.fetch_failed", {
      origin,
      error: err instanceof Error ? err.message : String(err),
    });
    rules = EMPTY_RULES;
  }

  robotsCache.set(cacheKey, { rules, fetchedAt: now() });
  return rules;
}

/**
 * Returns true when `rawUrl` may be crawled per the origin's robots.txt. Invalid
 * or non-http(s) URLs are rejected; everything else is fail-open.
 */
export async function isUrlAllowed(rawUrl: string, deps: RobotsDeps = {}): Promise<boolean> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;

  const userAgent = deps.userAgent ?? ROBOTS_USER_AGENT;
  const fetchText = deps.fetchText ?? fetchHtml;
  const now = deps.now ?? Date.now;

  const rules = await loadRules(url.origin, userAgent, fetchText, now);
  return isPathAllowed(rules, url.pathname + url.search);
}
