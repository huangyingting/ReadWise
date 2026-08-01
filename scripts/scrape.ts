import { readFile } from "node:fs/promises";

import { prisma } from "@/lib/prisma";
import { closeBrowser } from "@/lib/scraper/fetch-browser";
import { PROVIDERS, getProvider, providerForUrl } from "@/lib/scraper/providers";
import { extractArticle } from "@/lib/scraper/extract";
import { discoverProviderUrls } from "@/lib/scraper/discovery";
import {
  saveDraftArticle,
  scrapeAndSave,
  type SaveOutcome,
} from "@/lib/scraper";
import { findExistingPublicLibrarySourceUrls } from "@/lib/article-library/policy";
import { isProviderEnabled, recordCrawlRun } from "@/lib/scraper/sources";
import type { Provider } from "@/lib/scraper/types";
import { runCli, isMain, warnUnknown } from "./lib/cli";

type Args = {
  urls: string[];
  provider: string | null;
  all: boolean;
  limit: number;
  file: string | null;
  fileUrl: string | null;
  dryRun: boolean;
  listProviders: boolean;
  help: boolean;
};

type CrawlRunStats = {
  scraped: number;
  failed: number;
  duplicates: number;
  rejected: number;
};

type OutcomeStatusCounts = {
  saved: number;
  skipped: number;
  failed: number;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {
    urls: [],
    provider: null,
    all: false,
    limit: 5,
    file: null,
    fileUrl: null,
    dryRun: false,
    listProviders: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--provider":
        args.provider = argv[++i] ?? null;
        break;
      case "--all":
        args.all = true;
        break;
      case "--limit":
        args.limit = Math.max(1, Number(argv[++i]) || 5);
        break;
      case "--file":
        args.file = argv[++i] ?? null;
        break;
      case "--url":
        args.fileUrl = argv[++i] ?? null;
        break;
      case "--dry-run":
        args.dryRun = true;
        break;
      case "--list-providers":
        args.listProviders = true;
        break;
      case "-h":
      case "--help":
        args.help = true;
        break;
      default:
        if (arg.startsWith("-")) {
          warnUnknown(arg);
        } else {
          args.urls.push(arg);
        }
    }
  }
  return args;
}

export { parseArgs };

function printHelp(): void {
  console.log(`ReadWise article scraper

Usage:
  npm run scrape -- <url> [<url> ...]          Scrape one or more article URLs
  npm run scrape -- --provider <key> [--limit N]  Discover & scrape a provider
  npm run scrape -- --all [--limit N]          Discover & scrape every provider
  npm run scrape -- --file <path> --url <url>  Extract from a local HTML file
  npm run scrape -- --list-providers           List supported providers

Options:
  --limit N     Max articles per provider during discovery (default 5)
  --dry-run     Extract and print, but do not save to the database
  --help        Show this help

Providers: ${PROVIDERS.map((p) => p.key).join(", ")}`);
}

function summarize(outcome: SaveOutcome): void {
  if (outcome.status === "saved") {
    const a = outcome.article;
    console.log(
      `  ✓ saved   [${a.source}] ${a.title}\n` +
        `            id=${outcome.id} category=${a.category ?? "-"} words=${a.wordCount} url=${a.sourceUrl}`,
    );
  } else if (outcome.status === "skipped") {
    console.log(`  • skipped ${outcome.reason}: ${outcome.sourceUrl}`);
  } else {
    console.log(`  ✗ failed  ${outcome.reason}: ${outcome.sourceUrl}`);
  }
}

function previewArticle<T extends { content: string }>(article: T): T {
  return { ...article, content: `${article.content.slice(0, 200)}…` };
}

function isDuplicateSkip(outcome: SaveOutcome): boolean {
  return outcome.status === "skipped" && /duplicate/i.test(outcome.reason);
}

function isExtractFailure(outcome: SaveOutcome): boolean {
  return outcome.status === "failed" && /extract/i.test(outcome.reason);
}

function outcomeStatusCounts(outcomes: SaveOutcome[]): OutcomeStatusCounts {
  return {
    saved: outcomes.filter((outcome) => outcome.status === "saved").length,
    skipped: outcomes.filter((outcome) => outcome.status === "skipped").length,
    failed: outcomes.filter((outcome) => outcome.status === "failed").length,
  };
}

async function runFile(args: Args): Promise<SaveOutcome[]> {
  if (!args.file) return [];
  const html = await readFile(args.file, "utf8");
  const sourceUrl = args.fileUrl ?? `file://${args.file}`;
  const article = extractArticle(html, sourceUrl);
  if (!article) {
    return [{ status: "failed", reason: "could not extract article content", sourceUrl }];
  }
  if (args.dryRun) {
    console.log(JSON.stringify(previewArticle(article), null, 2));
    return [{ status: "skipped", reason: "dry-run", sourceUrl }];
  }
  return [await saveDraftArticle(article)];
}

async function dryRunUrl(url: string): Promise<SaveOutcome> {
  try {
    const { scrapeUrl } = await import("@/lib/scraper");
    const article = await scrapeUrl(url);
    if (article) {
      console.log(JSON.stringify(previewArticle(article), null, 2));
      return { status: "skipped", reason: "dry-run", sourceUrl: url };
    }
    return { status: "failed", reason: "extract failed", sourceUrl: url };
  } catch {
    return {
      status: "failed",
      reason: "article_fetch_failed",
      sourceUrl: url,
    };
  }
}

async function runUrls(urls: string[], dryRun: boolean): Promise<SaveOutcome[]> {
  const outcomes: SaveOutcome[] = [];
  for (const url of urls) {
    const provider = providerForUrl(url);
    console.log(`Scraping ${url}${provider ? ` (${provider.name})` : ""}`);
    outcomes.push(dryRun ? await dryRunUrl(url) : await scrapeAndSave(url));
    summarize(outcomes[outcomes.length - 1]);
  }
  return outcomes;
}

function crawlRunStats(outcomes: SaveOutcome[]): CrawlRunStats {
  const counts = outcomeStatusCounts(outcomes);
  return {
    scraped: counts.saved,
    failed: counts.failed,
    duplicates: outcomes.filter(isDuplicateSkip).length,
    rejected: outcomes.filter(isExtractFailure).length,
  };
}

async function runProvider(provider: Provider, limit: number, dryRun: boolean): Promise<SaveOutcome[]> {
  const startedAt = Date.now();
  if (!(await isProviderEnabled(provider.key))) {
    console.log(`Skipping ${provider.name} — content source is disabled.`);
    return [];
  }

  console.log(`Discovering up to ${limit} articles from ${provider.name}…`);
  let urls: string[] = [];
  let discoverError: string | null = null;
  try {
    urls = await discoverProviderUrls(provider, limit);
  } catch {
    discoverError = "crawl_discovery_failed";
  }
  const discoveredCount = urls.length;
  let alreadyHave = 0;
  if (!dryRun) {
    try {
      const existing = await findExistingPublicLibrarySourceUrls(urls);
      urls = urls.filter((url) => !existing.has(url));
      alreadyHave = discoveredCount - urls.length;
    } catch {
      console.warn("  ! could not pre-filter already-saved articles; scraping unfiltered URL list.");
    }
  }
  console.log(
    `Found ${discoveredCount} article URL(s)${alreadyHave > 0 ? ` — ${urls.length} new, ${alreadyHave} already saved` : ""}.`,
  );

  const outcomes = await runUrls(urls, dryRun);

  // Record provider health + ingestion quality from this run (RW-050). Dry runs
  // are excluded — they don't represent real ingestion.
  if (!dryRun) {
    const stats = crawlRunStats(outcomes);
    try {
      await recordCrawlRun(provider.key, {
        discovered: discoveredCount,
        scraped: stats.scraped,
        failed: stats.failed,
        duplicates: stats.duplicates,
        rejected: stats.rejected,
        source: "cli",
        mode: "provider",
        durationMs: Date.now() - startedAt,
        error: discoverError,
      });
    } catch {
      console.warn("  ! could not record crawl health.");
    }
  }

  return outcomes;
}

function printProviderList(): void {
  for (const p of PROVIDERS) {
    console.log(`${p.key.padEnd(10)} ${p.name} (${p.hostnames[0]})`);
  }
}

function summarizeOutcomes(outcomes: SaveOutcome[]): {
  saved: number;
  skipped: number;
  failed: number;
} {
  return outcomeStatusCounts(outcomes);
}

async function main(argv = process.argv.slice(2)): Promise<number> {
  const args = parseArgs(argv);

  if (args.help) {
    printHelp();
    return 0;
  }
  if (args.listProviders) {
    printProviderList();
    return 0;
  }

  const outcomes: SaveOutcome[] = [];

  if (args.file) {
    outcomes.push(...(await runFile(args)));
  }

  if (args.all) {
    for (const provider of PROVIDERS) {
      outcomes.push(...(await runProvider(provider, args.limit, args.dryRun)));
    }
  } else if (args.provider) {
    const provider = getProvider(args.provider);
    if (!provider) {
      console.error(`Unknown provider "${args.provider}". Try --list-providers.`);
      return 1;
    }
    outcomes.push(...(await runProvider(provider, args.limit, args.dryRun)));
  }

  if (args.urls.length > 0) {
    outcomes.push(...(await runUrls(args.urls, args.dryRun)));
  }

  if (!args.file && !args.all && !args.provider && args.urls.length === 0) {
    printHelp();
    return 0;
  }

  const { saved, skipped, failed } = summarizeOutcomes(outcomes);
  console.log(`\nDone. saved=${saved} skipped=${skipped} failed=${failed}`);

  return failed > 0 && saved === 0 ? 1 : 0;
}

function runScrapeCli(
  argv = process.argv.slice(2),
  deps?: Parameters<typeof runCli>[1],
): void {
  runCli(async () => {
    try {
      return await main(argv);
    } finally {
      try {
        await closeBrowser();
      } catch {
        // Best-effort cleanup only; do not mask the scrape outcome.
      }
    }
  }, deps);
}

export const __scrapeTest = {
  printHelp,
  summarize,
  runFile,
  runUrls,
  runProvider,
  main,
  runScrapeCli,
};

if (isMain(import.meta.url)) {
  runScrapeCli();
}
