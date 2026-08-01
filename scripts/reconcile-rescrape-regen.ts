import {
  countUnclaimedRescrapeRegen,
  reconcileUnclaimedRescrapeRegen,
  RECONCILE_DEFAULT_LIMIT,
} from "@/lib/scraper/incremental/rescrape-regen-reconcile";
import { isMain, parseFlag, parsePositiveInt, runCli, shouldDryRun } from "./lib/cli";

const HELP = `Usage: npm run maintenance:rescrape-regen -- [--dry-run|--execute] [--limit <n>]\n\nReconciles stamped-but-unclaimed force-rescrape derived regeneration (#1132):\nACTIVE content versions whose derivedRegenerationRequestedAt is set but that have\nno rescrape-regen:<versionId> claim step (a lost enqueue after activation). It\nre-invokes the existing idempotent requestDerivedRegeneration for each, so a\nconcurrent runner + this sweep converge on exactly one claim + one rebuild.\nDefaults to dry-run/count mode. Output is metadata-only JSON (ids never logged).\n\nOptions:\n  --dry-run          Count the backlog only (default)\n  --execute          Re-drive up to --limit unclaimed versions\n  --limit <n>        Max versions to re-drive per run (default ${RECONCILE_DEFAULT_LIMIT})\n  --help, -h         Show this help\n`;

type ReconcileOptions = {
  dryRun: boolean;
  limit: number;
};

export type RescrapeRegenRunResult = {
  dryRun: boolean;
  executed: boolean;
  limit: number;
  /** Dry-run: full stamped-but-unclaimed backlog. Execute: versions acted on this run. */
  matched: number;
  reDriven: number;
  alreadyClaimed: number;
};

type CliIo = {
  log?: (message: string) => void;
  error?: (message: string) => void;
};

function parseOptions(argv: string[]): ReconcileOptions | "help" {
  if (parseFlag(argv, "--help", "-h")) return "help";
  return {
    dryRun: shouldDryRun(argv),
    limit: parsePositiveInt(argv, "--limit", RECONCILE_DEFAULT_LIMIT),
  };
}

export async function runRescrapeRegenReconcile(
  options: ReconcileOptions,
): Promise<RescrapeRegenRunResult> {
  if (options.dryRun) {
    const matched = await countUnclaimedRescrapeRegen();
    return {
      dryRun: true,
      executed: false,
      limit: options.limit,
      matched,
      reDriven: 0,
      alreadyClaimed: 0,
    };
  }
  const result = await reconcileUnclaimedRescrapeRegen({ limit: options.limit });
  return {
    dryRun: false,
    executed: true,
    limit: options.limit,
    matched: result.scanned,
    reDriven: result.reDriven,
    alreadyClaimed: result.alreadyClaimed,
  };
}

export async function reconcileRescrapeRegenMain(
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
  const result = await runRescrapeRegenReconcile(options);
  log(JSON.stringify(result, null, 2));
  if (!result.executed) {
    error("Dry run only. Re-run with --execute to reconcile unclaimed versions.");
  }
  return 0;
}

if (isMain(import.meta.url)) runCli(() => reconcileRescrapeRegenMain());
