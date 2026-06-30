import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

import { ArticleStatus, ArticleVisibility } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { discoverProviderUrls } from "@/lib/scraper/discovery";
import { stripTags } from "@/lib/scraper/extract";
import { scrapeAndSave, type SaveOutcome } from "@/lib/scraper";
import { getProvider } from "@/lib/scraper/providers";
import { recordCrawlRun } from "@/lib/scraper/sources";
import type { Provider } from "@/lib/scraper/types";
import {
  isMain,
  parseFlag,
  parsePositiveInt,
  parseString,
  runCli,
  warnUnknown,
} from "./lib/cli";

const PROVIDER_KEY = "undark";
const PROVIDER_NAME = "Undark";
const DEFAULT_LIMIT = 100;
const DEFAULT_CONCURRENCY = 3;
const DEFAULT_VISITED_FILE = ".scraper-state/undark-visited-urls.json";
const VISITED_RECORD_VERSION = 1;
const NOISE_BLOCK_MAX_CHARS = 360;

type Args = {
  limit: number;
  concurrency: number;
  visitedFile: string;
  includeVisited: boolean;
  targetSaved: boolean;
  untilExhausted: boolean;
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

type ProviderDbCounts = {
  total: number;
  published: number;
  drafts: number;
  missingPublishedAt: number;
  duplicateGroups: number;
  duplicateRows: number;
};

type FreshUrlSelection = {
  freshUrls: string[];
  skippedSeen: number;
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
  hint: string;
};

const NOISE_PATTERNS: NoisePattern[] = [
  {
    key: "support",
    label: "support/donation CTA",
    regex:
      /\b(support undark magazine|undark is a non-profit, editorially independent magazine|help support our journalism|make a donation|donate to undark)\b/i,
    hint: "Undark provider cleanup dropTextKeywords",
  },
  {
    key: "newsletter",
    label: "newsletter promo",
    regex:
      /\b(newsletter journeys|dive deeper into pressing issues|limited run newsletters|hand-picked archive excerpt|sign up for (?:our|the) newsletter)\b/i,
    hint: "Undark provider cleanup dropClassKeywords/dropTextKeywords",
  },
  {
    key: "recirculation",
    label: "related/recommended recirculation",
    regex:
      /^(related stories|recommended for you|most popular|popular reads|read more stories|more from undark|up next)\b[\s:.\-–—]*$/i,
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
    key: "advertising",
    label: "advertising or sponsored-content label",
    regex: /^(advertisement|advertising|sponsored content|paid post)\b[\s:.\-–—]*$/i,
    hint: "provider cleanup dropClassKeywords or shared declutter if genuinely global",
  },
];

function parseArgs(argv: string[]): Args {
  const publishExplicit = parseFlag(argv, "--publish");
  const draftExplicit = parseFlag(argv, "--draft");
  const args: Args = {
    limit: parsePositiveInt(argv, "--limit", DEFAULT_LIMIT),
    concurrency: parsePositiveInt(argv, "--concurrency", DEFAULT_CONCURRENCY),
    visitedFile: parseString(argv, "--visited-file") ?? DEFAULT_VISITED_FILE,
    includeVisited: parseFlag(argv, "--include-visited"),
    targetSaved: parseFlag(argv, "--target-saved"),
    untilExhausted:
      parseFlag(argv, "--all") || parseFlag(argv, "--until-exhausted"),
    analyzeOnly: parseFlag(argv, "--analyze-only"),
    publish: publishExplicit || !draftExplicit,
    help: parseFlag(argv, "--help", "-h"),
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (["--limit", "--concurrency", "--visited-file"].includes(arg)) {
      i += 1;
      continue;
    }
    if (
      [
        "--include-visited",
        "--target-saved",
        "--all",
        "--until-exhausted",
        "--analyze-only",
        "--publish",
        "--draft",
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
  console.log(`Undark scrape/analyze workflow

Usage:
  npm run scrape:undark -- --all
  npm run scrape:undark -- --limit 100 --target-saved
  npm run scrape:undark -- --analyze-only

Options:
  --limit N              Max fresh Undark articles to scrape unless --all is set (default ${DEFAULT_LIMIT})
  --concurrency N        Parallel article scrapes when not using --target-saved (default ${DEFAULT_CONCURRENCY})
  --visited-file <path>  Repo-local URL visit record (default ${DEFAULT_VISITED_FILE})
  --include-visited      Scrape discovered URLs even if already in the visit record/DB
  --target-saved         Keep scraping until N articles are saved or candidates run out
  --all, --until-exhausted
                         Scrape all fresh URLs discoverable from configured Undark paths
  --analyze-only         Skip discovery/scrape and only analyze Undark rows in the DB
  --publish              Publish ownerless Undark DB rows after scraping (default)
  --draft                Do not publish newly saved/ownerless Undark rows
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

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
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

export function accountedUndarkUrlSet(
  entries: Array<{ url: string; lastOutcome: VisitedOutcome }>,
): Set<string> {
  return new Set(
    entries
      .filter((entry) => entry.lastOutcome === "saved" || entry.lastOutcome === "duplicate")
      .map((entry) => normalizeUrl(entry.url) ?? entry.url),
  );
}

export function undarkDiscoveryLimit(
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

export function selectFreshUndarkUrls(
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
    skippedSeen: discoveredUrls.length - unvisitedUrls.length,
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

function summarizeProgress(index: number, total: number, outcome: SaveOutcome): void {
  const prefix = `${index}/${total}`;
  if (outcome.status === "saved") {
    console.log(
      `  ✓ ${prefix} saved words=${outcome.article.wordCount} category=${outcome.article.category ?? "-"} url=${outcome.article.sourceUrl}`,
    );
  } else if (outcome.status === "skipped") {
    console.log(`  • ${prefix} skipped ${outcome.reason}: ${outcome.sourceUrl}`);
  } else {
    console.log(`  ✗ ${prefix} failed ${outcome.reason}: ${outcome.sourceUrl}`);
  }
}

function providerOrThrow(): Provider {
  const provider = getProvider(PROVIDER_KEY);
  if (!provider) throw new Error("Undark provider is not registered.");
  return provider;
}

function undarkLibraryWhere() {
  return { source: PROVIDER_NAME, ownerId: null } as const;
}

async function existingUndarkUrlSet(): Promise<Set<string>> {
  const rows = await prisma.article.findMany({
    where: { ...undarkLibraryWhere(), sourceUrl: { not: null } },
    select: { sourceUrl: true },
  });
  return new Set(
    rows
      .map((row) => (row.sourceUrl ? normalizeUrl(row.sourceUrl) : null))
      .filter((url): url is string => Boolean(url)),
  );
}

async function publishArticle(id: string, publishedAt: Date | null): Promise<void> {
  await prisma.article.update({
    where: { id },
    data: {
      status: ArticleStatus.PUBLISHED,
      visibility: ArticleVisibility.PUBLIC,
      publishedAt: publishedAt ?? new Date(),
    },
  });
}

async function scrapeOne(
  url: string,
  record: VisitedRecord,
  publish: boolean,
): Promise<SaveOutcome> {
  const outcome = await scrapeAndSave(url);
  if (outcome.status === "saved") {
    if (publish) await publishArticle(outcome.id, outcome.article.publishedAt);
    markVisited(record, outcome.article.sourceUrl, "saved");
  } else if (
    outcome.status === "skipped" &&
    /duplicate/i.test(outcome.reason)
  ) {
    markVisited(record, outcome.sourceUrl, "duplicate");
  } else if (outcome.status === "failed") {
    markVisited(record, outcome.sourceUrl, "failed");
  }
  return outcome;
}

async function scrapeSequential(
  freshUrls: string[],
  record: VisitedRecord,
  publish: boolean,
  targetSaved: boolean,
  limit: number,
): Promise<SaveOutcome[]> {
  const outcomes: SaveOutcome[] = [];
  for (let i = 0; i < freshUrls.length; i++) {
    const url = freshUrls[i]!;
    console.log(`Scraping ${i + 1}/${freshUrls.length}: ${url}`);
    const outcome = await scrapeOne(url, record, publish);
    outcomes.push(outcome);
    summarizeProgress(i + 1, freshUrls.length, outcome);
    if (
      targetSaved &&
      outcomes.filter((o) => o.status === "saved").length >= limit
    ) {
      break;
    }
  }
  return outcomes;
}

async function scrapeConcurrent(
  freshUrls: string[],
  record: VisitedRecord,
  publish: boolean,
  concurrency: number,
): Promise<SaveOutcome[]> {
  const outcomes: SaveOutcome[] = [];
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, concurrency), freshUrls.length);

  async function worker(): Promise<void> {
    for (;;) {
      const index = nextIndex++;
      if (index >= freshUrls.length) return;
      const url = freshUrls[index]!;
      console.log(`Scraping ${index + 1}/${freshUrls.length}: ${url}`);
      const outcome = await scrapeOne(url, record, publish);
      outcomes[index] = outcome;
      summarizeProgress(index + 1, freshUrls.length, outcome);
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return outcomes.filter(Boolean);
}

async function scrapeFreshUndark(
  provider: Provider,
  limit: number,
  concurrency: number,
  record: VisitedRecord,
  includeVisited: boolean,
  targetSaved: boolean,
  untilExhausted: boolean,
  publish: boolean,
): Promise<{
  outcomes: SaveOutcome[];
  discovered: number;
  skippedSeen: number;
  discoveryExhausted: boolean;
  remainingFresh: number;
}> {
  for (const url of await existingUndarkUrlSet()) {
    markVisited(record, url, "saved");
  }

  const seen = accountedUndarkUrlSet(record.urls);
  const discoverLimit = undarkDiscoveryLimit(
    limit,
    seen.size,
    includeVisited,
    targetSaved,
    untilExhausted,
  );
  const discoveryExhausted = untilExhausted;

  console.log(
    untilExhausted
      ? "Discovering all Undark article URLs from configured public paths…"
      : `Discovering up to ${discoverLimit} Undark article URL(s)…`,
  );
  const discoveredUrls = await discoverProviderUrls(provider, discoverLimit);
  const { freshUrls, skippedSeen } = selectFreshUndarkUrls(
    discoveredUrls,
    seen,
    limit,
    includeVisited,
    targetSaved,
    untilExhausted,
  );

  console.log(
    `Found ${discoveredUrls.length}; ${freshUrls.length} selected for scraping; ${skippedSeen} already accounted; ` +
      `discoveryExhausted=${discoveryExhausted ? "yes" : "no"}.`,
  );

  const outcomes =
    freshUrls.length === 0
      ? []
      : targetSaved && !untilExhausted
        ? await scrapeSequential(freshUrls, record, publish, targetSaved, limit)
        : await scrapeConcurrent(freshUrls, record, publish, concurrency);

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

  const finalSeen = accountedUndarkUrlSet(record.urls);
  const remainingFresh = discoveredUrls.filter(
    (url) => !finalSeen.has(normalizeUrl(url) ?? url),
  ).length;

  return {
    outcomes,
    discovered: discoveredUrls.length,
    skippedSeen,
    discoveryExhausted,
    remainingFresh,
  };
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
      hint: pattern.hint,
    };
    findings.set(pattern.key, finding);
  }
  return finding;
}

export function analyzeArticles(articles: ArticleForAnalysis[]): NoiseFinding[] {
  const findings = new Map<string, NoiseFinding>();

  for (const article of articles) {
    const url = article.sourceUrl ?? article.title;
    for (const text of extractBlocks(article.content)) {
      if (text.length > NOISE_BLOCK_MAX_CHARS) continue;
      for (const pattern of NOISE_PATTERNS) {
        if (!pattern.regex.test(text)) continue;
        const finding = findingFor(pattern, findings);
        finding.affectedUrls.add(url);
        finding.occurrences += 1;
      }
    }
  }

  return [...findings.values()]
    .filter((finding) => finding.affectedUrls.size >= 2)
    .sort(
      (a, b) =>
        b.affectedUrls.size - a.affectedUrls.size ||
        b.occurrences - a.occurrences,
    );
}

async function analyzeUndarkFromDb(): Promise<NoiseFinding[]> {
  const articles = await prisma.article.findMany({
    where: undarkLibraryWhere(),
    orderBy: { createdAt: "asc" },
    select: { title: true, sourceUrl: true, content: true, wordCount: true },
  });

  const totalWords = articles.reduce(
    (sum, article) => sum + (article.wordCount ?? 0),
    0,
  );
  console.log(
    `Analyzing ${articles.length} Undark article(s) from DB (${totalWords} stored words).`,
  );
  if (articles.length === 0) {
    console.log("No Undark articles are present in the DB to analyze.");
    return [];
  }

  const findings = analyzeArticles(articles);
  if (findings.length === 0) {
    console.log(
      "Filter analysis: no recurring non-article noise candidates were found in the stored Undark articles.",
    );
    return [];
  }

  console.log("Filter analysis: recurring non-article noise candidates found:");
  for (const finding of findings) {
    console.log(
      `- ${finding.label}: ${finding.affectedUrls.size}/${articles.length} article(s), ${finding.occurrences} occurrence(s); suggested seam: ${finding.hint}.`,
    );
  }
  return findings;
}

function duplicateStats(sourceUrls: Array<string | null>): Pick<ProviderDbCounts, "duplicateGroups" | "duplicateRows"> {
  const counts = new Map<string, number>();
  for (const raw of sourceUrls) {
    if (!raw) continue;
    const url = normalizeUrl(raw) ?? raw;
    counts.set(url, (counts.get(url) ?? 0) + 1);
  }
  let duplicateGroups = 0;
  let duplicateRows = 0;
  for (const count of counts.values()) {
    if (count <= 1) continue;
    duplicateGroups += 1;
    duplicateRows += count - 1;
  }
  return { duplicateGroups, duplicateRows };
}

async function providerDbCounts(source: string): Promise<ProviderDbCounts> {
  const baseWhere = { source, ownerId: null } as const;
  const [total, published, drafts, missingPublishedAt, sourceRows] =
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
      prisma.article.findMany({
        where: baseWhere,
        select: { sourceUrl: true },
      }),
    ]);
  const duplicates = duplicateStats(sourceRows.map((row) => row.sourceUrl));

  return { total, published, drafts, missingPublishedAt, ...duplicates };
}

async function publishUndarkArticles(): Promise<ProviderDbCounts> {
  const baseWhere = undarkLibraryWhere();
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

  const counts = await providerDbCounts(PROVIDER_NAME);
  console.log(
    `Published Undark articles: statusOrVisibilityUpdated=${publicationUpdate.count} ` +
      `publishedAtFilled=${publishedAtUpdate.count} total=${counts.total} ` +
      `published=${counts.published} drafts=${counts.drafts} ` +
      `missingPublishedAt=${counts.missingPublishedAt}.`,
  );
  return counts;
}

function continueCommand(args: Args): string {
  const parts = [
    "npm run scrape:undark --",
    "--all",
    `--limit ${args.limit}`,
    `--concurrency ${args.concurrency}`,
  ];
  if (!args.publish) parts.push("--draft");
  return parts.join(" ");
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return 0;
  }

  const visitedFile = resolveRepoLocalPath(args.visitedFile);
  const record = await readVisited(visitedFile);
  const provider = providerOrThrow();

  let outcomes: SaveOutcome[] = [];
  let discovered = 0;
  let skippedSeen = 0;
  let remainingFresh = 0;
  let discoveryExhausted = false;

  if (!args.analyzeOnly) {
    const result = await scrapeFreshUndark(
      provider,
      args.limit,
      args.concurrency,
      record,
      args.includeVisited,
      args.targetSaved,
      args.untilExhausted,
      args.publish,
    );
    outcomes = result.outcomes;
    discovered = result.discovered;
    skippedSeen = result.skippedSeen;
    remainingFresh = result.remainingFresh;
    discoveryExhausted = result.discoveryExhausted;
    await writeVisited(visitedFile, record);
  }

  if (args.publish) {
    await publishUndarkArticles();
  }

  const findings = await analyzeUndarkFromDb();
  const undarkCounts = await providerDbCounts(PROVIDER_NAME);
  const smithsonianCounts = await providerDbCounts("Smithsonian Magazine");

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
        `accountedSkipped=${skippedSeen} remainingFresh=${remainingFresh} ` +
        `visitedRecord=${path.relative(repoRoot(), visitedFile)} visitedTotal=${record.urls.length}`,
    );
    if (remainingFresh > 0 || !discoveryExhausted) {
      console.log(`Continue command: ${continueCommand(args)}`);
    } else {
      console.log("Continue command: none; configured Undark discovery is exhausted.");
    }
  }

  console.log(
    `Final Undark DB: total=${undarkCounts.total} published=${undarkCounts.published} ` +
      `drafts=${undarkCounts.drafts} missingPublishedAt=${undarkCounts.missingPublishedAt} ` +
      `duplicateGroups=${undarkCounts.duplicateGroups} duplicateRows=${undarkCounts.duplicateRows}.`,
  );
  console.log(
    `Final Smithsonian DB: total=${smithsonianCounts.total} published=${smithsonianCounts.published} ` +
      `drafts=${smithsonianCounts.drafts} missingPublishedAt=${smithsonianCounts.missingPublishedAt}.`,
  );

  return failed > 0 && saved === 0 ? 1 : findings.length > 0 ? 0 : 0;
}

if (isMain(import.meta.url)) {
  runCli(main);
}
