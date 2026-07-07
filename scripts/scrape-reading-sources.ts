import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

import { findExistingPublicLibrarySourceUrls } from "@/lib/article-library/policy";
import { closeBrowser } from "@/lib/scraper/fetch-browser";
import { discoverProviderUrls } from "@/lib/scraper/discovery";
import { getProvider } from "@/lib/scraper/providers";
import { recordCrawlRun } from "@/lib/scraper/sources";
import { scrapeAndSave, type SaveOutcome } from "@/lib/scraper";
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

export const READING_SOURCE_PROVIDER_KEYS = [
  "atlasobscura",
  "jstordaily",
  "hakaimagazine",
  "yalee360",
  "worksinprogress",
] as const;

const DEFAULT_LIMIT = 100;
const DEFAULT_CONCURRENCY = 2;
const DEFAULT_OUT_DIR = ".scraper-state/reading-sources";

type ReadingSourceProviderKey = (typeof READING_SOURCE_PROVIDER_KEYS)[number];

type Args = {
  providers: string[];
  limit: number;
  concurrency: number;
  outDir: string;
  includeExisting: boolean;
  untilExhausted: boolean;
  targetSaved: boolean;
  scrape: boolean;
  writeUrls: boolean;
  help: boolean;
};

type FreshUrlSelection = {
  freshUrls: string[];
  skippedExisting: number;
};

type SaveOutcomeCounts = {
  saved: number;
  skipped: number;
  duplicates: number;
  failed: number;
  rejected: number;
};

function parseProviderKeys(argv: string[]): string[] {
  const providers: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg !== "--provider" && arg !== "--providers") continue;
    const value = argv[i + 1];
    if (!value) continue;
    addUniqueFromCsv(providers, value.toLowerCase());
    i += 1;
  }
  return providers.includes("all") || providers.length === 0
    ? [...READING_SOURCE_PROVIDER_KEYS]
    : providers;
}

export function parseArgs(argv: string[]): Args {
  const scrape = parseFlag(argv, "--scrape");
  const discoverOnly = parseFlag(argv, "--discover-only");
  const args: Args = {
    providers: parseProviderKeys(argv),
    limit: parsePositiveInt(argv, "--limit", DEFAULT_LIMIT),
    concurrency: parsePositiveInt(argv, "--concurrency", DEFAULT_CONCURRENCY),
    outDir: parseString(argv, "--out-dir") ?? DEFAULT_OUT_DIR,
    includeExisting: parseFlag(argv, "--include-existing"),
    untilExhausted: parseFlag(argv, "--all") || parseFlag(argv, "--until-exhausted"),
    targetSaved: parseFlag(argv, "--target-saved"),
    scrape: scrape && !discoverOnly,
    writeUrls: parseFlag(argv, "--write-urls") || !scrape || discoverOnly,
    help: parseFlag(argv, "--help", "-h"),
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (["--provider", "--providers", "--limit", "--concurrency", "--out-dir"].includes(arg)) {
      i += 1;
      continue;
    }
    if (
      [
        "--include-existing",
        "--all",
        "--until-exhausted",
        "--target-saved",
        "--scrape",
        "--discover-only",
        "--write-urls",
        "--help",
        "-h",
      ].includes(arg)
    )
      continue;
    if (arg.startsWith("-")) warnUnknown(arg);
  }

  return args;
}

function printHelp(): void {
  console.log(`Reading-source discovery/scrape workflow

Usage:
  npm run scrape:reading-sources -- --discover-only --all
  npm run scrape:reading-sources -- --provider atlasobscura --limit 500
  npm run scrape:reading-sources -- --provider jstordaily --scrape --target-saved --limit 100

Options:
  --provider key          Provider key to process; repeat or comma-separate. Defaults to all.
                          Keys: ${READING_SOURCE_PROVIDER_KEYS.join(", ")}
  --limit N              Per-provider URL/saved target when not using --all (default ${DEFAULT_LIMIT})
  --concurrency N        Parallel scrapes per provider when not using --target-saved (default ${DEFAULT_CONCURRENCY})
  --out-dir <path>       Directory for URL lists (default ${DEFAULT_OUT_DIR})
  --include-existing     Do not exclude sourceUrls already present in the DB
  --all, --until-exhausted
                          Discover all configured candidates for each provider
  --target-saved         With --scrape, continue until N articles are saved or candidates run out
  --scrape               Actually scrape and save selected fresh URLs; omitted means discover-only
  --discover-only        Force no DB writes except existing-URL lookup
  --write-urls           Write selected fresh URL lists even while scraping
  --help                 Show this help`);
}

export function readingSourceDiscoveryLimit(args: Pick<Args, "limit" | "targetSaved" | "untilExhausted">): number {
  if (args.untilExhausted) return Number.POSITIVE_INFINITY;
  if (args.targetSaved) return args.limit * 10;
  return args.limit;
}

export function selectFreshReadingSourceUrls(
  discovered: string[],
  existing: Set<string>,
  limit: number,
  includeExisting: boolean,
  targetSaved: boolean,
  untilExhausted: boolean,
): FreshUrlSelection {
  const fresh = includeExisting ? discovered : discovered.filter((url) => !existing.has(url));
  const selected = targetSaved || untilExhausted ? fresh : fresh.slice(0, limit);
  return {
    freshUrls: selected,
    skippedExisting: includeExisting ? 0 : discovered.length - fresh.length,
  };
}

function isDuplicateSkipped(outcome: SaveOutcome): boolean {
  return outcome.status === "skipped" && /duplicate/i.test(outcome.reason);
}

function isRejectedFailure(outcome: SaveOutcome): boolean {
  return outcome.status === "failed" && /(content quality|could not extract|extract failed)/i.test(outcome.reason);
}

export function countSaveOutcomes(outcomes: SaveOutcome[]): SaveOutcomeCounts {
  return {
    saved: outcomes.filter((outcome) => outcome.status === "saved").length,
    skipped: outcomes.filter((outcome) => outcome.status === "skipped").length,
    duplicates: outcomes.filter(isDuplicateSkipped).length,
    failed: outcomes.filter((outcome) => outcome.status === "failed").length,
    rejected: outcomes.filter(isRejectedFailure).length,
  };
}

function resolveProviders(keys: string[]): Provider[] {
  const providers: Provider[] = [];
  for (const key of keys) {
    const provider = getProvider(key);
    if (!provider) {
      throw new Error(`Unknown reading-source provider: ${key}`);
    }
    if (!READING_SOURCE_PROVIDER_KEYS.includes(provider.key as ReadingSourceProviderKey)) {
      throw new Error(`Provider is not part of this non-sports reading-source workflow: ${key}`);
    }
    providers.push(provider);
  }
  return providers;
}

function repoPath(input: string): string {
  return path.resolve(process.cwd(), input);
}

function urlListPath(outDir: string, providerKey: string): string {
  return path.join(repoPath(outDir), `${providerKey}-fresh-urls.txt`);
}

async function writeUrlList(outDir: string, providerKey: string, urls: string[]): Promise<string> {
  const filePath = urlListPath(outDir, providerKey);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${urls.join("\n")}${urls.length > 0 ? "\n" : ""}`, "utf8");
  return filePath;
}

async function scrapeSequential(urls: string[], targetSaved: number): Promise<SaveOutcome[]> {
  const outcomes: SaveOutcome[] = [];
  let saved = 0;
  for (const url of urls) {
    const outcome = await scrapeAndSave(url);
    outcomes.push(outcome);
    if (outcome.status === "saved") saved += 1;
    if (saved >= targetSaved) break;
  }
  return outcomes;
}

async function scrapeConcurrent(urls: string[], concurrency: number): Promise<SaveOutcome[]> {
  const outcomes: SaveOutcome[] = [];
  let next = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= urls.length) return;
      outcomes[index] = await scrapeAndSave(urls[index]!);
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, urls.length) }, () => worker());
  await Promise.all(workers);
  return outcomes.filter(Boolean);
}

async function runProvider(provider: Provider, args: Args): Promise<void> {
  const discoveryLimit = readingSourceDiscoveryLimit(args);
  console.log(`\n== ${provider.name} (${provider.key}) ==`);
  console.log(
    `Discovering ${Number.isFinite(discoveryLimit) ? `up to ${discoveryLimit}` : "all"} candidate URLs...`,
  );

  const discovered = await discoverProviderUrls(provider, discoveryLimit);
  const existing = args.includeExisting
    ? new Set<string>()
    : await findExistingPublicLibrarySourceUrls(discovered);
  const selection = selectFreshReadingSourceUrls(
    discovered,
    existing,
    args.limit,
    args.includeExisting,
    args.targetSaved,
    args.untilExhausted,
  );

  console.log(
    `Discovered ${discovered.length}; selected ${selection.freshUrls.length}; skipped existing ${selection.skippedExisting}.`,
  );

  if (args.writeUrls) {
    const filePath = await writeUrlList(args.outDir, provider.key, selection.freshUrls);
    console.log(`Wrote URL list: ${path.relative(process.cwd(), filePath)}`);
  }

  if (!args.scrape || selection.freshUrls.length === 0) {
    return;
  }

  const outcomes = args.targetSaved && !args.untilExhausted
    ? await scrapeSequential(selection.freshUrls, args.limit)
    : await scrapeConcurrent(selection.freshUrls, args.concurrency);
  const counts = countSaveOutcomes(outcomes);
  await recordCrawlRun(provider.key, {
    discovered: discovered.length,
    scraped: counts.saved,
    failed: counts.failed,
    duplicates: counts.duplicates,
    rejected: counts.rejected,
  });
  console.log(
    `Saved ${counts.saved}; skipped ${counts.skipped}; failed ${counts.failed}; rejected ${counts.rejected}.`,
  );
}

async function main(argv = process.argv.slice(2)): Promise<number> {
  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return 0;
  }

  const providers = resolveProviders(args.providers);
  try {
    for (const provider of providers) {
      await runProvider(provider, args);
    }
  } finally {
    await closeBrowser();
  }
  return 0;
}

export const __readingSourcesTest = {
  printHelp,
  parseProviderKeys,
  isDuplicateSkipped,
  isRejectedFailure,
  resolveProviders,
  repoPath,
  urlListPath,
  writeUrlList,
  scrapeSequential,
  scrapeConcurrent,
  runProvider,
  main,
};

if (isMain(import.meta.url)) {
  runCli(main);
}
