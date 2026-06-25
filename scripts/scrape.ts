import { readFile } from "node:fs/promises";

import { prisma } from "@/lib/prisma";
import { PROVIDERS, getProvider, providerForUrl } from "@/lib/scraper/providers";
import { extractArticle } from "@/lib/scraper/extract";
import { discoverProviderUrls } from "@/lib/scraper/discovery";
import {
  saveDraftArticle,
  scrapeAndSave,
  type SaveOutcome,
} from "@/lib/scraper";
import { isProviderEnabled, recordCrawlRun } from "@/lib/content-sources";
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

async function runFile(args: Args): Promise<SaveOutcome[]> {
  if (!args.file) return [];
  const html = await readFile(args.file, "utf8");
  const sourceUrl = args.fileUrl ?? `file://${args.file}`;
  const article = extractArticle(html, sourceUrl);
  if (!article) {
    return [{ status: "failed", reason: "could not extract article content", sourceUrl }];
  }
  if (args.dryRun) {
    console.log(JSON.stringify({ ...article, content: `${article.content.slice(0, 200)}…` }, null, 2));
    return [{ status: "skipped", reason: "dry-run", sourceUrl }];
  }
  return [await saveDraftArticle(article)];
}

async function runUrls(urls: string[], dryRun: boolean): Promise<SaveOutcome[]> {
  const outcomes: SaveOutcome[] = [];
  for (const url of urls) {
    const provider = providerForUrl(url);
    console.log(`Scraping ${url}${provider ? ` (${provider.name})` : ""}`);
    if (dryRun) {
      try {
        const { scrapeUrl } = await import("@/lib/scraper");
        const article = await scrapeUrl(url);
        if (article) {
          console.log(
            JSON.stringify({ ...article, content: `${article.content.slice(0, 200)}…` }, null, 2),
          );
          outcomes.push({ status: "skipped", reason: "dry-run", sourceUrl: url });
        } else {
          outcomes.push({ status: "failed", reason: "extract failed", sourceUrl: url });
        }
      } catch (err) {
        outcomes.push({
          status: "failed",
          reason: err instanceof Error ? err.message : String(err),
          sourceUrl: url,
        });
      }
    } else {
      outcomes.push(await scrapeAndSave(url));
    }
    summarize(outcomes[outcomes.length - 1]);
  }
  return outcomes;
}

async function runProvider(provider: Provider, limit: number, dryRun: boolean): Promise<SaveOutcome[]> {
  if (!(await isProviderEnabled(provider.key))) {
    console.log(`Skipping ${provider.name} — content source is disabled.`);
    return [];
  }

  console.log(`Discovering up to ${limit} articles from ${provider.name}…`);
  let urls: string[] = [];
  let discoverError: string | null = null;
  try {
    urls = await discoverProviderUrls(provider, limit);
  } catch (err) {
    discoverError = err instanceof Error ? err.message : String(err);
  }
  console.log(`Found ${urls.length} article URL(s).`);

  const outcomes = await runUrls(urls, dryRun);

  // Record provider health + ingestion quality from this run (RW-050). Dry runs
  // are excluded — they don't represent real ingestion.
  if (!dryRun) {
    const scraped = outcomes.filter((o) => o.status === "saved").length;
    const failed = outcomes.filter((o) => o.status === "failed").length;
    const duplicates = outcomes.filter(
      (o) => o.status === "skipped" && /duplicate/i.test(o.reason),
    ).length;
    const rejected = outcomes.filter(
      (o) => o.status === "failed" && /extract/i.test(o.reason),
    ).length;
    try {
      await recordCrawlRun(provider.key, {
        discovered: urls.length,
        scraped,
        failed,
        duplicates,
        rejected,
        error: discoverError,
      });
    } catch (err) {
      console.warn(
        `  ! could not record crawl health: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return outcomes;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    return 0;
  }
  if (args.listProviders) {
    for (const p of PROVIDERS) {
      console.log(`${p.key.padEnd(10)} ${p.name} (${p.hostnames[0]})`);
    }
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

  const saved = outcomes.filter((o) => o.status === "saved").length;
  const skipped = outcomes.filter((o) => o.status === "skipped").length;
  const failed = outcomes.filter((o) => o.status === "failed").length;
  console.log(`\nDone. saved=${saved} skipped=${skipped} failed=${failed}`);

  return failed > 0 && saved === 0 ? 1 : 0;
}

if (isMain(import.meta.url)) {
  runCli(main);
}
