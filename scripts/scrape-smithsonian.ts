import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

import { ArticleStatus, ArticleVisibility } from "@prisma/client";
import { findExistingPublicLibrarySourceUrls } from "@/lib/article-library/policy";
import { prisma } from "@/lib/prisma";
import { discoverProviderUrls } from "@/lib/scraper/discovery";
import { stripTags } from "@/lib/scraper/extract";
import { scrapeAndSave, type SaveOutcome } from "@/lib/scraper";
import { getProvider } from "@/lib/scraper/providers";
import { createSmithsonianProvider } from "@/lib/scraper/providers/smithsonian";
import { recordCrawlRun } from "@/lib/scraper/sources";
import type { Provider } from "@/lib/scraper/types";
import {
  addUniqueFromCsv,
  isMain,
  parseFlag,
  parsePositiveInt,
  parseString,
  runCli,
  warnUnknown,
} from "./lib/cli";

const PROVIDER_KEY = "smithsonian";
const PROVIDER_NAME = "Smithsonian Magazine";
const DEFAULT_LIMIT = 50;
const DEFAULT_VISITED_FILE = ".scraper-state/smithsonian-visited-urls.json";
const VISITED_RECORD_VERSION = 1;
const NOISE_BLOCK_MAX_CHARS = 360;

type Args = {
  limit: number;
  visitedFile: string;
  includeVisited: boolean;
  targetSaved: boolean;
  untilExhausted: boolean;
  sinceYear: number | null;
  excludeSections: string[];
  sitemapOnly: boolean;
  categoryVisibleOnly: boolean;
  analyzeOnly: boolean;
  publish: boolean;
  help: boolean;
};

type VisitedOutcome = "saved" | "duplicate" | "failed";

type VisitedUrl = {
  url: string;
  firstVisitedAt: string;
  lastVisitedAt: string;
  lastOutcome: VisitedOutcome;
};

type VisitedRecord = {
  version: typeof VISITED_RECORD_VERSION;
  provider: typeof PROVIDER_KEY;
  updatedAt: string;
  urls: VisitedUrl[];
};

type ArticleForAnalysis = {
  title: string;
  sourceUrl: string | null;
  content: string;
  wordCount: number | null;
};

type SmithsonianDbCounts = {
  total: number;
  published: number;
  drafts: number;
  missingPublishedAt: number;
};

type FreshUrlSelection = {
  freshUrls: string[];
  skippedVisited: number;
};

type NoisePattern = {
  key: string;
  label: string;
  regex: RegExp;
  hint: string;
};

type NoiseFinding = {
  key: string;
  label: string;
  affectedUrls: Set<string>;
  occurrences: number;
  samples: string[];
  hint: string;
};

const NOISE_PATTERNS: NoisePattern[] = [
  {
    key: "subscription",
    label: "subscription/newsletter/issue promo",
    regex:
      /\b(subscribe to smithsonian(?: magazine)?|sign up for (?:our|the) newsletter|get the latest stories (?:in your inbox|from smithsonian)|current issue|issue of smithsonian magazine|smithsonian magazine app)\b/i,
    hint: "provider cleanup dropTextKeywords/dropLinkHrefKeywords",
  },
  {
    key: "advertising",
    label: "advertising or sponsored-content label",
    regex: /^(advertisement|advertising|sponsored content|paid post)\b[\s:.\-–—]*$/i,
    hint: "provider cleanup dropClassKeywords or shared declutter if genuinely global",
  },
  {
    key: "recirculation",
    label: "related/recommended/popular recirculation",
    regex:
      /^(related stories|recommended for you|most popular|popular reads|read more stories|more from smithsonian|up next)\b[\s:.\-–—]*$/i,
    hint: "provider cleanup dropClassKeywords/dropTextKeywords",
  },
  {
    key: "social",
    label: "share/follow/comment chrome",
    regex:
      /\b(share this article|follow us|leave a comment|view comments|comments are open)\b/i,
    hint: "provider cleanup dropClassKeywords/dropTextKeywords",
  },
  {
    key: "media-label",
    label: "standalone media labels or image credits",
    regex: /^(featured\s+video|watch:?|video|image\s+credits?\s*[:：\-–—])/i,
    hint: "declutter for global standalone labels, or provider cleanup if Smithsonian-specific",
  },
];

function parseOptionalPositiveInt(argv: string[], flag: string): number | null {
  const value = parseString(argv, flag);
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseCsvFlagValues(argv: string[], ...flags: string[]): string[] {
  const values: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (!flags.includes(argv[i]!)) continue;
    const value = argv[i + 1];
    if (value == null) continue;
    addUniqueFromCsv(values, value.toLowerCase());
    i += 1;
  }
  return values;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    limit: parsePositiveInt(argv, "--limit", DEFAULT_LIMIT),
    visitedFile: parseString(argv, "--visited-file") ?? DEFAULT_VISITED_FILE,
    includeVisited: parseFlag(argv, "--include-visited"),
    targetSaved: parseFlag(argv, "--target-saved"),
    untilExhausted:
      parseFlag(argv, "--all") || parseFlag(argv, "--until-exhausted"),
    sinceYear: parseOptionalPositiveInt(argv, "--since-year"),
    excludeSections: parseCsvFlagValues(
      argv,
      "--exclude-section",
      "--exclude-sections",
    ),
    sitemapOnly: parseFlag(argv, "--sitemap-only"),
    categoryVisibleOnly: parseFlag(argv, "--category-visible-only"),
    analyzeOnly: parseFlag(argv, "--analyze-only"),
    publish: parseFlag(argv, "--publish"),
    help: parseFlag(argv, "--help", "-h"),
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (
      [
        "--limit",
        "--visited-file",
        "--since-year",
        "--exclude-section",
        "--exclude-sections",
      ].includes(arg)
    ) {
      i += 1;
      continue;
    }
    if (
      [
        "--include-visited",
        "--target-saved",
        "--all",
        "--until-exhausted",
        "--sitemap-only",
        "--category-visible-only",
        "--analyze-only",
        "--publish",
        "--help",
        "-h",
      ].includes(arg)
    )
      continue;
    if (arg.startsWith("-")) warnUnknown(arg);
  }

  return args;
}

export { parseArgs };

function printHelp(): void {
  console.log(`Smithsonian reset/scrape/analyze workflow

Usage:
  npm run smithsonian:reset-scrape-analyze
  npm run scrape:smithsonian -- --limit 50
  npm run scrape:smithsonian -- --analyze-only

Options:
  --limit N              Max fresh Smithsonian articles to scrape (default ${DEFAULT_LIMIT})
  --visited-file <path>  Repo-local URL visit record (default ${DEFAULT_VISITED_FILE})
  --include-visited      Scrape discovered URLs even if already in the visit record
  --target-saved         Keep discovering until N articles are saved or candidates run out
  --all, --until-exhausted
                         Scrape all fresh URLs discoverable from the Smithsonian sitemap/category archives
  --since-year YYYY      Only discover article sitemaps from YYYY onward (e.g. 2010)
  --exclude-section s    Exclude a Smithsonian URL section; repeat or comma-separate (e.g. smart-news)
  --sitemap-only         Do not crawl category archive pagination after the sitemap pass
  --category-visible-only
                         When category archives are crawled, keep only URLs visible in categories
  --analyze-only         Skip discovery/scrape and only analyze Smithsonian rows in the DB
  --publish              Publish ownerless Smithsonian DB rows after analysis
  --help                 Show this help`);
}

function repoRoot(): string {
  return process.cwd();
}

function resolveRepoLocalPath(input: string): string {
  const root = path.resolve(repoRoot());
  const resolved = path.resolve(root, input);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Visited file must be inside the repository: ${input}`);
  }
  return resolved;
}

function normalizeUrl(raw: string): string | null {
  try {
    return new URL(raw).href.split("#")[0] ?? raw;
  } catch {
    return null;
  }
}

function isVisitedRecord(value: unknown): value is VisitedRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<VisitedRecord>;
  return (
    record.version === VISITED_RECORD_VERSION &&
    record.provider === PROVIDER_KEY &&
    Array.isArray(record.urls) &&
    record.urls.every(
      (entry) =>
        entry &&
        typeof entry.url === "string" &&
        typeof entry.firstVisitedAt === "string" &&
        typeof entry.lastVisitedAt === "string" &&
        (entry.lastOutcome === "saved" ||
          entry.lastOutcome === "duplicate" ||
          entry.lastOutcome === "failed"),
    )
  );
}

async function readVisited(filePath: string): Promise<VisitedRecord> {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (isVisitedRecord(parsed)) return parsed;
    console.warn(
      `Visited record ${path.relative(repoRoot(), filePath)} is invalid; ignoring it.`,
    );
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(
        `Could not read visited record ${path.relative(repoRoot(), filePath)}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
  return {
    version: VISITED_RECORD_VERSION,
    provider: PROVIDER_KEY,
    updatedAt: new Date(0).toISOString(),
    urls: [],
  };
}

async function writeVisited(
  filePath: string,
  record: VisitedRecord,
): Promise<void> {
  const cleanUrls = [...record.urls]
    .map((entry) => ({ ...entry, url: normalizeUrl(entry.url) ?? entry.url }))
    .filter(
      (entry, index, entries) =>
        entries.findIndex((e) => e.url === entry.url) === index,
    )
    .sort((a, b) => a.firstVisitedAt.localeCompare(b.firstVisitedAt));

  const next: VisitedRecord = {
    version: VISITED_RECORD_VERSION,
    provider: PROVIDER_KEY,
    updatedAt: new Date().toISOString(),
    urls: cleanUrls,
  };

  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
}

function visitedSet(record: VisitedRecord): Set<string> {
  return new Set(
    record.urls.map((entry) => normalizeUrl(entry.url) ?? entry.url),
  );
}

export function smithsonianDiscoveryLimit(
  limit: number,
  visitedCount: number,
  includeVisited: boolean,
  targetSaved: boolean,
  untilExhausted: boolean,
): number {
  if (untilExhausted) return Number.POSITIVE_INFINITY;
  return includeVisited
    ? limit
    : Math.max(limit, limit + visitedCount + (targetSaved ? limit * 4 : 0));
}

export function selectFreshSmithsonianUrls(
  discoveredUrls: string[],
  seen: Set<string>,
  limit: number,
  includeVisited: boolean,
  targetSaved: boolean,
  untilExhausted: boolean,
): FreshUrlSelection {
  const unvisitedUrls = discoveredUrls.filter(
    (url) => !seen.has(normalizeUrl(url) ?? url),
  );
  const selectedLimit =
    untilExhausted || targetSaved ? discoveredUrls.length : limit;
  const freshUrls = includeVisited
    ? discoveredUrls.slice(0, untilExhausted ? discoveredUrls.length : limit)
    : unvisitedUrls.slice(0, selectedLimit);

  return {
    freshUrls,
    skippedVisited: discoveredUrls.length - unvisitedUrls.length,
  };
}

function markVisited(
  record: VisitedRecord,
  url: string,
  outcome: VisitedOutcome,
): void {
  const normalized = normalizeUrl(url);
  if (!normalized) return;
  const now = new Date().toISOString();
  const existing = record.urls.find(
    (entry) => normalizeUrl(entry.url) === normalized,
  );
  if (existing) {
    existing.lastVisitedAt = now;
    existing.lastOutcome = outcome;
  } else {
    record.urls.push({
      url: normalized,
      firstVisitedAt: now,
      lastVisitedAt: now,
      lastOutcome: outcome,
    });
  }
}

function summarize(outcome: SaveOutcome): void {
  if (outcome.status === "saved") {
    const a = outcome.article;
    console.log(
      `  ✓ saved   ${a.title} (words=${a.wordCount}, category=${a.category ?? "-"}, url=${a.sourceUrl})`,
    );
  } else if (outcome.status === "skipped") {
    console.log(`  • skipped ${outcome.reason}: ${outcome.sourceUrl}`);
  } else {
    console.log(`  ✗ failed  ${outcome.reason}: ${outcome.sourceUrl}`);
  }
}

function providerOrThrow(): Provider {
  const provider = getProvider(PROVIDER_KEY);
  if (!provider) throw new Error("Smithsonian provider is not registered.");
  return provider;
}

async function scrapeFreshSmithsonian(
  provider: Provider,
  limit: number,
  record: VisitedRecord,
  includeVisited: boolean,
  targetSaved: boolean,
  untilExhausted: boolean,
): Promise<{
  outcomes: SaveOutcome[];
  discovered: number;
  skippedVisited: number;
  discoveryExhausted: boolean;
}> {
  const seen = visitedSet(record);
  const discoverLimit = smithsonianDiscoveryLimit(
    limit,
    seen.size,
    includeVisited,
    targetSaved,
    untilExhausted,
  );
  const discoveryExhausted = untilExhausted;

  console.log(
    untilExhausted
      ? "Discovering all Smithsonian article URLs from configured seeds/pagination…"
      : `Discovering up to ${discoverLimit} Smithsonian article URL(s)…`,
  );
  const discoveredUrls = await discoverProviderUrls(provider, discoverLimit);
  const { freshUrls, skippedVisited } = selectFreshSmithsonianUrls(
    discoveredUrls,
    seen,
    limit,
    includeVisited,
    targetSaved,
    untilExhausted,
  );
  let selectedUrls = freshUrls;
  let skippedExisting = 0;

  if (!includeVisited && selectedUrls.length > 0) {
    const existing = await findExistingPublicLibrarySourceUrls(selectedUrls);
    selectedUrls = selectedUrls.filter((url) => !existing.has(url));
    skippedExisting = freshUrls.length - selectedUrls.length;
  }

  console.log(
    `Found ${discoveredUrls.length}; ${selectedUrls.length} selected for scraping; ` +
      `${skippedVisited} already visited; ${skippedExisting} already saved in DB; ` +
      `discoveryExhausted=${discoveryExhausted ? "yes" : "no"}.`,
  );
  if (selectedUrls.length === 0)
    return {
      outcomes: [],
      discovered: discoveredUrls.length,
      skippedVisited,
      discoveryExhausted,
    };

  const outcomes: SaveOutcome[] = [];
  for (let i = 0; i < selectedUrls.length; i++) {
    const url = selectedUrls[i]!;
    console.log(`Scraping ${i + 1}/${selectedUrls.length}: ${url}`);
    const outcome = await scrapeAndSave(url);
    outcomes.push(outcome);
    summarize(outcome);
    if (outcome.status === "saved") {
      markVisited(record, outcome.article.sourceUrl, "saved");
      if (
        targetSaved &&
        !untilExhausted &&
        outcomes.filter((o) => o.status === "saved").length >= limit
      ) {
        break;
      }
    } else if (
      outcome.status === "skipped" &&
      /duplicate/i.test(outcome.reason)
    ) {
      markVisited(record, outcome.sourceUrl, "duplicate");
    } else if (outcome.status === "failed") {
      markVisited(record, outcome.sourceUrl, "failed");
    }
  }

  const failed = outcomes.filter((o) => o.status === "failed").length;
  const duplicates = outcomes.filter(
    (o) => o.status === "skipped" && /duplicate/i.test(o.reason),
  ).length;
  const rejected = outcomes.filter(
    (o) => o.status === "failed" && /extract|quality/i.test(o.reason),
  ).length;
  await recordCrawlRun(provider.key, {
    discovered: discoveredUrls.length,
    scraped: outcomes.filter((o) => o.status === "saved").length,
    failed,
    duplicates,
    rejected,
  });

  return {
    outcomes,
    discovered: discoveredUrls.length,
    skippedVisited,
    discoveryExhausted,
  };
}

function truncate(value: string, max = 150): string {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}

function extractBlocks(html: string): string[] {
  const blocks = [
    ...html.matchAll(
      /<(p|li|h[2-6]|blockquote|figcaption)\b[^>]*>([\s\S]*?)<\/\1>/gi,
    ),
  ]
    .map((match) => stripTags(match[2] ?? ""))
    .map((text) => text.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  if (blocks.length > 0) return blocks;
  const fallback = stripTags(html).replace(/\s+/g, " ").trim();
  return fallback ? [fallback] : [];
}

function findingFor(
  pattern: NoisePattern,
  findings: Map<string, NoiseFinding>,
): NoiseFinding {
  let finding = findings.get(pattern.key);
  if (!finding) {
    finding = {
      key: pattern.key,
      label: pattern.label,
      affectedUrls: new Set<string>(),
      occurrences: 0,
      samples: [],
      hint: pattern.hint,
    };
    findings.set(pattern.key, finding);
  }
  return finding;
}

function addSample(finding: NoiseFinding, text: string): void {
  const sample = truncate(text);
  if (finding.samples.length < 3 && !finding.samples.includes(sample)) {
    finding.samples.push(sample);
  }
}

export function analyzeArticles(articles: ArticleForAnalysis[]): NoiseFinding[] {
  const findings = new Map<string, NoiseFinding>();
  const repeated = new Map<
    string,
    { text: string; urls: Set<string>; occurrences: number }
  >();

  for (const article of articles) {
    const url = article.sourceUrl ?? article.title;
    for (const text of extractBlocks(article.content)) {
      if (text.length > NOISE_BLOCK_MAX_CHARS) continue;
      for (const pattern of NOISE_PATTERNS) {
        if (!pattern.regex.test(text)) continue;
        const finding = findingFor(pattern, findings);
        finding.affectedUrls.add(url);
        finding.occurrences += 1;
        addSample(finding, text);
      }

      const normalized = text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
      if (normalized.length < 20) continue;
      if (!NOISE_PATTERNS.some((pattern) => pattern.regex.test(text))) continue;
      const entry = repeated.get(normalized) ?? {
        text,
        urls: new Set<string>(),
        occurrences: 0,
      };
      entry.urls.add(url);
      entry.occurrences += 1;
      repeated.set(normalized, entry);
    }
  }

  for (const [key, entry] of repeated.entries()) {
    if (entry.urls.size < 2) continue;
    const finding = findings.get(`repeated:${key}`) ?? {
      key: `repeated:${key}`,
      label: "repeated exact short noise block",
      affectedUrls: new Set<string>(),
      occurrences: 0,
      samples: [],
      hint: "provider cleanup dropTextKeywords when the repeated block is not article prose",
    };
    for (const url of entry.urls) finding.affectedUrls.add(url);
    finding.occurrences += entry.occurrences;
    addSample(finding, entry.text);
    findings.set(finding.key, finding);
  }

  return [...findings.values()]
    .filter((finding) => finding.affectedUrls.size >= 2)
    .sort(
      (a, b) =>
        b.affectedUrls.size - a.affectedUrls.size ||
        b.occurrences - a.occurrences,
    );
}

async function analyzeSmithsonianFromDb(): Promise<NoiseFinding[]> {
  const articles = await prisma.article.findMany({
    where: { source: PROVIDER_NAME, ownerId: null },
    orderBy: { createdAt: "asc" },
    select: { title: true, sourceUrl: true, content: true, wordCount: true },
  });

  const totalWords = articles.reduce(
    (sum, article) => sum + (article.wordCount ?? 0),
    0,
  );
  console.log(
    `Analyzing ${articles.length} Smithsonian article(s) from DB (${totalWords} stored words).`,
  );
  if (articles.length === 0) {
    console.log("No Smithsonian articles are present in the DB to analyze.");
    return [];
  }

  const findings = analyzeArticles(articles);
  if (findings.length === 0) {
    console.log(
      "Filter analysis: no recurring non-article noise candidates were found in the stored Smithsonian articles.",
    );
    return [];
  }

  console.log("Filter analysis: recurring non-article noise candidates found:");
  for (const finding of findings) {
    console.log(
      `- ${finding.label}: ${finding.affectedUrls.size}/${articles.length} article(s), ${finding.occurrences} occurrence(s).`,
    );
    console.log(`  Evidence snippets: ${finding.samples.join(" | ")}`);
    console.log(`  Suggested seam: ${finding.hint}.`);
  }
  return findings;
}

function smithsonianLibraryWhere() {
  return { source: PROVIDER_NAME, ownerId: null } as const;
}

async function smithsonianDbCounts(): Promise<SmithsonianDbCounts> {
  const baseWhere = smithsonianLibraryWhere();
  const [total, published, drafts, missingPublishedAt] =
    await prisma.$transaction([
      prisma.article.count({ where: baseWhere }),
      prisma.article.count({
        where: {
          ...baseWhere,
          status: ArticleStatus.PUBLISHED,
          visibility: ArticleVisibility.PUBLIC,
        },
      }),
      prisma.article.count({
        where: { ...baseWhere, status: ArticleStatus.DRAFT },
      }),
      prisma.article.count({
        where: { ...baseWhere, publishedAt: null },
      }),
    ]);

  return { total, published, drafts, missingPublishedAt };
}

async function publishSmithsonianArticles(): Promise<SmithsonianDbCounts> {
  const baseWhere = smithsonianLibraryWhere();
  const now = new Date();
  const [publicationUpdate, publishedAtUpdate] = await prisma.$transaction([
    prisma.article.updateMany({
      where: {
        ...baseWhere,
        OR: [
          { status: { not: ArticleStatus.PUBLISHED } },
          { visibility: { not: ArticleVisibility.PUBLIC } },
        ],
      },
      data: {
        status: ArticleStatus.PUBLISHED,
        visibility: ArticleVisibility.PUBLIC,
      },
    }),
    prisma.article.updateMany({
      where: { ...baseWhere, publishedAt: null },
      data: { publishedAt: now },
    }),
  ]);

  const counts = await smithsonianDbCounts();
  console.log(
    `Published Smithsonian articles: statusOrVisibilityUpdated=${publicationUpdate.count} ` +
      `publishedAtFilled=${publishedAtUpdate.count} total=${counts.total} ` +
      `published=${counts.published} drafts=${counts.drafts} ` +
      `missingPublishedAt=${counts.missingPublishedAt}.`,
  );
  return counts;
}

async function main(argv = process.argv.slice(2)): Promise<number> {
  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return 0;
  }

  const visitedFile = resolveRepoLocalPath(args.visitedFile);
  const record = await readVisited(visitedFile);
  providerOrThrow();
  const provider = createSmithsonianProvider({
    sinceYear: args.sinceYear,
    excludeSections: args.excludeSections,
    includeCategoryArchives: !args.sitemapOnly && args.untilExhausted,
    categoryVisibleOnly: args.categoryVisibleOnly,
  });

  let outcomes: SaveOutcome[] = [];
  let discovered = 0;
  let skippedVisited = 0;
  let discoveryExhausted = false;

  if (!args.analyzeOnly) {
    const result = await scrapeFreshSmithsonian(
      provider,
      args.limit,
      record,
      args.includeVisited,
      args.targetSaved,
      args.untilExhausted,
    );
    outcomes = result.outcomes;
    discovered = result.discovered;
    skippedVisited = result.skippedVisited;
    discoveryExhausted = result.discoveryExhausted;
    await writeVisited(visitedFile, record);
  }

  const findings = await analyzeSmithsonianFromDb();

  if (args.publish) {
    await publishSmithsonianArticles();
  }

  const saved = outcomes.filter((o) => o.status === "saved").length;
  const skipped = outcomes.filter((o) => o.status === "skipped").length;
  const duplicates = outcomes.filter(
    (o) => o.status === "skipped" && /duplicate/i.test(o.reason),
  ).length;
  const failed = outcomes.filter((o) => o.status === "failed").length;
  if (!args.analyzeOnly) {
    console.log(
      `\nDone. discovered=${discovered} saved=${saved} skipped=${skipped} duplicates=${duplicates} failed=${failed} ` +
        `discoveryExhausted=${discoveryExhausted ? "yes" : "no"} ` +
        `visitedSkipped=${skippedVisited} visitedRecord=${path.relative(repoRoot(), visitedFile)} ` +
        `visitedTotal=${record.urls.length}`,
    );
  }

  return failed > 0 && saved === 0 ? 1 : findings.length > 0 ? 0 : 0;
}

export const __scrapeSmithsonianTest = {
  parseOptionalPositiveInt,
  parseCsvFlagValues,
  printHelp,
  resolveRepoLocalPath,
  normalizeUrl,
  isVisitedRecord,
  readVisited,
  writeVisited,
  visitedSet,
  markVisited,
  summarize,
  providerOrThrow,
  scrapeFreshSmithsonian,
  truncate,
  extractBlocks,
  findingFor,
  addSample,
  analyzeSmithsonianFromDb,
  smithsonianLibraryWhere,
  smithsonianDbCounts,
  publishSmithsonianArticles,
  main,
};

if (isMain(import.meta.url)) {
  runCli(main);
}
