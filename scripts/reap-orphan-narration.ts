import {
  countOrphanedNarrationAssets,
  reapOrphanedNarrationAssets,
  ORPHAN_NARRATION_GRACE_MINUTES,
  REAP_DEFAULT_LIMIT,
} from "@/lib/media/orphan-narration-retention";
import { isMain, parseFlag, parsePositiveInt, runCli, shouldDryRun } from "./lib/cli";

const HELP = `Usage: npm run maintenance:orphan-narration -- [--dry-run|--execute] [--grace-minutes <n>] [--limit <n>]\n\nReaps orphaned narration media blobs left after force-rescrape regeneration (#1131):\nspeech MediaAssets whose ArticleSpeech back-relation is NULL (the row was deleted so\nnarration regenerates from new content) but whose audio blob was never removed inline.\nDeletes the blob first, then the DB row only for blobs that deleted successfully, so a\nfailed blob delete keeps its row for the next sweep. Defaults to dry-run/count mode.\nOutput is metadata-only JSON (storageKeys, URLs, and ids are never logged).\n\nOptions:\n  --dry-run              Count the orphan backlog only (default)\n  --execute              Reap up to --limit orphaned narration blobs\n  --grace-minutes <n>    Skip assets created within the last <n> minutes (default ${ORPHAN_NARRATION_GRACE_MINUTES})\n  --limit <n>            Max assets to reap per run (default ${REAP_DEFAULT_LIMIT})\n  --help, -h             Show this help\n`;

type ReapOptions = {
  dryRun: boolean;
  graceMinutes: number;
  limit: number;
};

export type OrphanNarrationRunResult = {
  dryRun: boolean;
  executed: boolean;
  graceMinutes: number;
  limit: number;
  /** Dry-run: full orphan backlog. Execute: assets selected this run (<= limit). */
  matched: number;
  reaped: number;
  failed: number;
};

type CliIo = {
  log?: (message: string) => void;
  error?: (message: string) => void;
};

function parseOptions(argv: string[]): ReapOptions | "help" {
  if (parseFlag(argv, "--help", "-h")) return "help";
  return {
    dryRun: shouldDryRun(argv),
    graceMinutes: parsePositiveInt(argv, "--grace-minutes", ORPHAN_NARRATION_GRACE_MINUTES),
    limit: parsePositiveInt(argv, "--limit", REAP_DEFAULT_LIMIT),
  };
}

export async function runOrphanNarrationReap(
  options: ReapOptions,
): Promise<OrphanNarrationRunResult> {
  const graceMs = options.graceMinutes * 60 * 1000;
  if (options.dryRun) {
    const matched = await countOrphanedNarrationAssets({ graceMs });
    return {
      dryRun: true,
      executed: false,
      graceMinutes: options.graceMinutes,
      limit: options.limit,
      matched,
      reaped: 0,
      failed: 0,
    };
  }
  const result = await reapOrphanedNarrationAssets({ graceMs, limit: options.limit });
  return {
    dryRun: false,
    executed: true,
    graceMinutes: options.graceMinutes,
    limit: options.limit,
    matched: result.matched,
    reaped: result.reaped,
    failed: result.failed,
  };
}

export async function reapOrphanNarrationMain(
  argv = process.argv.slice(2),
  io: CliIo = {},
): Promise<number> {
  const log = io.log ?? console.log;
  const error = io.error ?? console.error;
  const options = parseOptions(argv);
  if (options === "help") {
    log(HELP.trimEnd());
    return 0;
  }
  const result = await runOrphanNarrationReap(options);
  log(JSON.stringify(result, null, 2));
  if (!result.executed) {
    error("Dry run only. Re-run with --execute to reap orphaned narration blobs.");
  }
  return 0;
}

if (isMain(import.meta.url)) runCli(() => reapOrphanNarrationMain());
