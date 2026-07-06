import { performance } from "node:perf_hooks";

import { isMain, parseFlag, parsePositiveInt, parseString, warnUnknown } from "./lib/cli";
import { isDifficultyLevel, type EnglishLevel } from "@/lib/leveling/cefr-primitives";

type Args = {
  iterations: number;
  limit: number;
  category: string | null;
  level: EnglishLevel | null;
  query: string | null;
  userId: string | null;
  cold: boolean;
  help: boolean;
};

type BenchmarkResult = {
  scenario: string;
  iterations: number;
  articles: number;
  hasMore: boolean;
  minMs: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
  avgMs: number;
};

let loadedDatabaseBackedModules = false;

function printHelp(): void {
  console.log(`ReadWise listing/feed benchmark

Runs safe app-level timing for listing paths without printing article content,
user ids, SQL, parameters, credentials, or database URLs.

Usage:
  npm run benchmark:listings -- [options]

Options:
  --iterations <n>     Runs per scenario (default 5)
  --limit <n>          Page size to request (default 12)
  --category <slug>    Browse category; omit or "all" for all public articles
  --level <A1-C2>      Optional CEFR cap
  --query <text>       Optional listing search query
  --user-id <id>       Also benchmark personalized /api/feed library path
  --cold               Disable listing cache for this process
  --help, -h           Show help

Safety:
  Non-SQLite DATABASE_URL values are refused unless
  READWISE_BENCHMARK_ALLOW_REMOTE_DB=1 is set. This avoids accidental production
  benchmarks by default.`);
}

function parseArgs(argv: string[]): Args {
  for (const arg of argv) {
    if (arg.startsWith("-") && !knownArg(arg)) warnUnknown(arg);
  }
  const level = parseString(argv, "--level");
  return {
    iterations: parsePositiveInt(argv, "--iterations", 5),
    limit: parsePositiveInt(argv, "--limit", 12),
    category: normalizeCategory(parseString(argv, "--category")),
    level: level && isDifficultyLevel(level) ? level : null,
    query: normalizeQuery(parseString(argv, "--query")),
    userId: normalizeQuery(parseString(argv, "--user-id")),
    cold: parseFlag(argv, "--cold"),
    help: parseFlag(argv, "--help", "-h"),
  };
}

function knownArg(arg: string): boolean {
  return [
    "--iterations",
    "--limit",
    "--category",
    "--level",
    "--query",
    "--user-id",
    "--cold",
    "--help",
    "-h",
  ].includes(arg);
}

function normalizeCategory(value: string | null): string | null {
  const normalized = normalizeQuery(value);
  return !normalized || normalized === "all" ? null : normalized;
}

function normalizeQuery(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function assertSafeBenchmarkDatabase(): boolean {
  const databaseUrl = process.env.DATABASE_URL ?? "file:./dev.db";
  if (databaseUrl.startsWith("file:")) return true;
  if (process.env.READWISE_BENCHMARK_ALLOW_REMOTE_DB === "1") return true;
  console.error(
    "Refusing to benchmark a non-SQLite DATABASE_URL. Set READWISE_BENCHMARK_ALLOW_REMOTE_DB=1 for an explicit staging/production-safe run.",
  );
  return false;
}

async function timeRun<T>(run: () => Promise<T>): Promise<{ durationMs: number; result: T }> {
  const startedAt = performance.now();
  const result = await run();
  return { durationMs: performance.now() - startedAt, result };
}

function percentile(sorted: number[], percentileRank: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.floor((percentileRank / 100) * sorted.length));
  return sorted[index] ?? 0;
}

function summarize(
  scenario: string,
  durations: number[],
  last: { articles: unknown[]; hasMore: boolean },
): BenchmarkResult {
  const sorted = [...durations].sort((a, b) => a - b);
  const sum = sorted.reduce((total, value) => total + value, 0);
  return {
    scenario,
    iterations: durations.length,
    articles: last.articles.length,
    hasMore: last.hasMore,
    minMs: Math.round(sorted[0] ?? 0),
    p50Ms: Math.round(percentile(sorted, 50)),
    p95Ms: Math.round(percentile(sorted, 95)),
    maxMs: Math.round(sorted[sorted.length - 1] ?? 0),
    avgMs: Math.round(sum / Math.max(1, sorted.length)),
  };
}

async function benchmarkScenario(
  scenario: string,
  iterations: number,
  run: () => Promise<{ articles: unknown[]; hasMore: boolean }>,
): Promise<BenchmarkResult> {
  const durations: number[] = [];
  let last = { articles: [], hasMore: false } as { articles: unknown[]; hasMore: boolean };
  for (let i = 0; i < iterations; i++) {
    const result = await timeRun(run);
    durations.push(result.durationMs);
    last = result.result;
  }
  return summarize(scenario, durations, last);
}

function printResults(results: BenchmarkResult[], cold: boolean): void {
  console.log(`Listing benchmark complete (cache=${cold ? "cold/disabled" : "normal"})`);
  for (const result of results) {
    console.log(
      `${result.scenario}: iterations=${result.iterations} articles=${result.articles} hasMore=${result.hasMore} ` +
        `avg=${result.avgMs}ms p50=${result.p50Ms}ms p95=${result.p95Ms}ms min=${result.minMs}ms max=${result.maxMs}ms`,
    );
  }
}

export { main, parseArgs };

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return 0;
  }
  if (!assertSafeBenchmarkDatabase()) return 1;
  if (args.cold) process.env.READWISE_DISABLE_LISTING_CACHE = "1";

  loadedDatabaseBackedModules = true;
  const [{ listCategoryPage }, { getPersonalizedFeed }] = await Promise.all([
    import("@/lib/article-library"),
    import("@/lib/feed"),
  ]);

  const results: BenchmarkResult[] = [];
  results.push(
    await benchmarkScenario("browse-listing", args.iterations, () =>
      listCategoryPage(args.category, {
        limit: args.limit,
        maxLevel: args.level,
        query: args.query,
      }),
    ),
  );

  if (args.userId) {
    results.push(
      await benchmarkScenario("personalized-feed", args.iterations, () =>
        getPersonalizedFeed(args.userId!, {
          limit: args.limit,
          maxLevel: args.level,
        }),
      ),
    );
  }

  printResults(results, args.cold);
  return 0;
}

async function disconnectIfNeeded(): Promise<void> {
  if (!loadedDatabaseBackedModules) return;
  const { prisma } = await import("@/lib/prisma");
  await prisma.$disconnect();
}

function runBenchmarkCli(): void {
  main()
    .then(async (code) => {
      await disconnectIfNeeded();
      process.exit(code);
    })
    .catch(async (error: unknown) => {
      await disconnectIfNeeded();
      console.error("benchmark listings failed:", error);
      process.exit(1);
    });
}

if (isMain(import.meta.url)) runBenchmarkCli();
