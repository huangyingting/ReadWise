import { prisma } from "@/lib/prisma";
import { articleHtmlToReaderText } from "@/lib/content-pipeline";
import { getMediaStorage, mediaStorageKind } from "@/lib/storage";
import {
  buildTokenAlignment,
  extractSpeechBoundaryTokens,
  type ComparableToken,
} from "@/lib/speech";
import { runCli, isMain, addUniqueFromCsv, warnUnknown } from "./lib/cli";

type SpeechTimingLike = {
  word: string;
};

type Args = {
  ids: string[];
  batchSize: number;
  progressRows: number;
  worstLimit: number;
  deleteBelow: number | null;
  apply: boolean;
  help: boolean;
};

type ArticleAlignmentStats = {
  id: string;
  status: string;
  wordCount: number | null;
  storageKey: string | null;
  coverage: number;
  boundaryTokens: number;
  covered: number;
  uncovered: number;
  timings: number;
  aligned: number;
  unaligned: number;
};

type ArticleSpeechAlignmentRow = {
  id: string;
  status: string;
  wordCount: number | null;
  content: string;
  speech: { words: unknown; storageKey: string | null } | null;
};

type CoverageResult = {
  covered: number;
  aligned: number;
};

const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_PROGRESS_ROWS = 250;
const DEFAULT_WORST_LIMIT = 20;

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    ids: [],
    batchSize: DEFAULT_BATCH_SIZE,
    progressRows: DEFAULT_PROGRESS_ROWS,
    worstLimit: DEFAULT_WORST_LIMIT,
    deleteBelow: null,
    apply: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--ids":
      case "--id":
        addUniqueFromCsv(args.ids, argv[++i] ?? "");
        break;
      case "--batch-size":
        args.batchSize = parsePositiveInteger(argv[++i], DEFAULT_BATCH_SIZE);
        break;
      case "--progress-rows":
        args.progressRows = parsePositiveInteger(argv[++i], DEFAULT_PROGRESS_ROWS);
        break;
      case "--worst-limit":
        args.worstLimit = parsePositiveInteger(argv[++i], DEFAULT_WORST_LIMIT);
        break;
      case "--delete-below": {
        const threshold = Number(argv[++i]);
        if (Number.isFinite(threshold) && threshold >= 0 && threshold <= 1) {
          args.deleteBelow = threshold;
        } else {
          throw new Error("--delete-below must be a number between 0 and 1, e.g. 0.9");
        }
        break;
      }
      case "--apply":
        args.apply = true;
        break;
      case "-h":
      case "--help":
        args.help = true;
        break;
      default:
        if (arg.startsWith("-")) {
          warnUnknown(arg);
        } else if (!args.ids.includes(arg)) {
          args.ids.push(arg);
        }
    }
  }

  return args;
}

function printHelp(): void {
  console.log(`ReadWise speech alignment analyzer

Scans ArticleSpeech.words against the canonical reader text and reports how
many reader speech-boundary tokens are covered by TTS word boundaries.

Usage:
  npm run analyze:speech-alignment
  npm run analyze:speech-alignment -- --ids article-127,article-2203

Options:
  --ids <ids>          Comma-separated article ids to inspect instead of all rows
  --batch-size N       Pagination size for full scan (default ${DEFAULT_BATCH_SIZE})
  --progress-rows N    Print progress every N scanned rows (default ${DEFAULT_PROGRESS_ROWS})
  --worst-limit N      Number of worst rows to include in output (default ${DEFAULT_WORST_LIMIT})
  --delete-below N     Also list ArticleSpeech rows below coverage N (0..1)
  --apply              Actually delete rows selected by --delete-below; otherwise dry-run
  --help              Show this help`);
}

function timingWordsFromJson(value: unknown): SpeechTimingLike[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const word = (entry as { word?: unknown }).word;
      return typeof word === "string" ? { word } : null;
    })
    .filter((entry): entry is SpeechTimingLike => Boolean(entry));
}

function coverage(tokens: ComparableToken[], words: SpeechTimingLike[]): CoverageResult {
  const { alignment, spanLengths } = buildTokenAlignment(tokens, words);
  const covered = new Uint8Array(tokens.length);
  let aligned = 0;

  for (let i = 0; i < alignment.length; i++) {
    const start = alignment[i];
    if (start == null) continue;
    aligned++;

    const length = spanLengths[i] ?? 1;
    const end = Math.min(tokens.length, start + length);
    for (let tokenIndex = start; tokenIndex < end; tokenIndex++) {
      covered[tokenIndex] = 1;
    }
  }

  let coveredCount = 0;
  for (const value of covered) coveredCount += value;

  return { covered: coveredCount, aligned };
}

function coverageBucket(value: number): "full" | "gte99" | "gte95" | "gte90" | "gte80" | "lt80" {
  if (value === 1) return "full";
  if (value >= 0.99) return "gte99";
  if (value >= 0.95) return "gte95";
  if (value >= 0.90) return "gte90";
  if (value >= 0.80) return "gte80";
  return "lt80";
}

function elapsedSeconds(startedAt: bigint): string {
  return (Number(process.hrtime.bigint() - startedAt) / 1_000_000_000).toFixed(1);
}

function buildArticleStats(row: ArticleSpeechAlignmentRow): ArticleAlignmentStats {
  const tokens = extractSpeechBoundaryTokens(articleHtmlToReaderText(row.content));
  const words = timingWordsFromJson(row.speech?.words);
  const result = coverage(tokens, words);
  const ratio = tokens.length ? result.covered / tokens.length : 0;

  return {
    id: row.id,
    status: row.status,
    wordCount: row.wordCount,
    storageKey: row.speech?.storageKey ?? null,
    coverage: Number(ratio.toFixed(4)),
    boundaryTokens: tokens.length,
    covered: result.covered,
    uncovered: tokens.length - result.covered,
    timings: words.length,
    aligned: result.aligned,
    unaligned: words.length - result.aligned,
  };
}

function pushWorst(
  worst: ArticleAlignmentStats[],
  item: ArticleAlignmentStats,
  limit: number,
): void {
  worst.push(item);
  worst.sort((a, b) => a.coverage - b.coverage || b.uncovered - a.uncovered);
  if (worst.length > limit) worst.pop();
}

async function analyzeIds(ids: string[]): Promise<ArticleAlignmentStats[]> {
  const rows: ArticleSpeechAlignmentRow[] = await prisma.article.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      status: true,
      wordCount: true,
      content: true,
      speech: { select: { words: true, storageKey: true } },
    },
  });

  return rows
    .sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id))
    .map(buildArticleStats);
}

async function analyzeAll(args: Args): Promise<{
  totalRows: number;
  buckets: Record<ReturnType<typeof coverageBucket>, number>;
  fullAligned: number;
  notFullAligned: number;
  overallBoundaryCoverage: number;
  totals: {
    boundaryTokens: number;
    coveredBoundaryTokens: number;
    uncoveredBoundaryTokens: number;
    timings: number;
    alignedTimings: number;
    unalignedTimings: number;
  };
  worst: ArticleAlignmentStats[];
  deletion?: {
    mode: "dry-run" | "applied";
    threshold: number;
    selectedCount: number;
    deletedCount: number;
    localFiles: {
      storageKind: ReturnType<typeof mediaStorageKind>;
      selectedCount: number;
      deletedCount: number;
      skippedCount: number;
      keys: string[];
    };
    selected: ArticleAlignmentStats[];
  };
}> {
  const buckets: Record<ReturnType<typeof coverageBucket>, number> = {
    full: 0,
    gte99: 0,
    gte95: 0,
    gte90: 0,
    gte80: 0,
    lt80: 0,
  };
  const worst: ArticleAlignmentStats[] = [];
  const deletionCandidates: ArticleAlignmentStats[] = [];
  const startedAt = process.hrtime.bigint();

  let totalRows = 0;
  let totalTokens = 0;
  let totalCovered = 0;
  let totalTimings = 0;
  let totalAligned = 0;
  let cursor: string | null = null;

  for (;;) {
    const rows: ArticleSpeechAlignmentRow[] = await prisma.article.findMany({
      where: { speech: { isNot: null } },
      orderBy: { id: "asc" },
      take: args.batchSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        status: true,
        wordCount: true,
        content: true,
        speech: { select: { words: true, storageKey: true } },
      },
    });

    if (!rows.length) break;

    for (const row of rows) {
      const stats = buildArticleStats(row);
      const ratio = stats.boundaryTokens ? stats.covered / stats.boundaryTokens : 0;
      totalRows++;
      buckets[coverageBucket(ratio)]++;
      totalTokens += stats.boundaryTokens;
      totalCovered += stats.covered;
      totalTimings += stats.timings;
      totalAligned += stats.aligned;
      pushWorst(worst, stats, args.worstLimit);
      if (args.deleteBelow != null && ratio < args.deleteBelow) {
        deletionCandidates.push(stats);
      }

      if (args.progressRows > 0 && totalRows % args.progressRows === 0) {
        console.error(
          `scanned=${totalRows} coverage=${(totalCovered / Math.max(1, totalTokens)).toFixed(4)} ` +
            `elapsed=${elapsedSeconds(startedAt)}s`,
        );
      }
    }

    cursor = rows.at(-1)?.id ?? null;
  }

  const localStorageKeys = [...new Set(
    deletionCandidates
      .map((item) => item.storageKey)
      .filter((key): key is string => Boolean(key)),
  )];
  const storageKind = mediaStorageKind();
  let deletedLocalFileCount = 0;

  if (args.deleteBelow != null && args.apply && localStorageKeys.length > 0 && storageKind === "filesystem") {
    const storage = getMediaStorage();
    if (storage?.kind === "filesystem") {
      for (const storageKey of localStorageKeys) {
        await storage.delete(storageKey);
        deletedLocalFileCount++;
      }
    }
  }

  const deletedCount = args.deleteBelow == null || deletionCandidates.length === 0 || !args.apply
    ? 0
    : (await prisma.articleSpeech.deleteMany({
        where: { articleId: { in: deletionCandidates.map((item) => item.id) } },
      })).count;

  return {
    totalRows,
    buckets,
    fullAligned: buckets.full,
    notFullAligned: totalRows - buckets.full,
    overallBoundaryCoverage: Number((totalCovered / Math.max(1, totalTokens)).toFixed(4)),
    totals: {
      boundaryTokens: totalTokens,
      coveredBoundaryTokens: totalCovered,
      uncoveredBoundaryTokens: totalTokens - totalCovered,
      timings: totalTimings,
      alignedTimings: totalAligned,
      unalignedTimings: totalTimings - totalAligned,
    },
    worst,
    ...(args.deleteBelow == null
      ? {}
      : {
          deletion: {
            mode: args.apply ? "applied" : "dry-run",
            threshold: args.deleteBelow,
            selectedCount: deletionCandidates.length,
            deletedCount,
            localFiles: {
              storageKind,
              selectedCount: localStorageKeys.length,
              deletedCount: deletedLocalFileCount,
              skippedCount: args.apply && storageKind === "filesystem"
                ? localStorageKeys.length - deletedLocalFileCount
                : localStorageKeys.length,
              keys: localStorageKeys,
            },
            selected: deletionCandidates.sort((a, b) => a.coverage - b.coverage || b.uncovered - a.uncovered),
          },
        }),
  };
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    return 0;
  }

  const startedAt = process.hrtime.bigint();
  try {
    const result = args.ids.length > 0
      ? { ids: args.ids, articles: await analyzeIds(args.ids) }
      : await analyzeAll(args);

    console.log(JSON.stringify({
      generatedAt: new Date().toISOString(),
      elapsedSeconds: Number(elapsedSeconds(startedAt)),
      result,
    }, null, 2));
    return 0;
  } finally {
    await prisma.$disconnect();
  }
}

if (isMain(import.meta.url)) {
  runCli(main);
}
