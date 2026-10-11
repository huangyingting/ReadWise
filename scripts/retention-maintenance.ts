import {
  retentionMaintenanceOptions,
  runRetentionMaintenance,
  type RetentionOptions,
  type RetentionRunResult,
} from "@/lib/retention/maintenance";
import { isMain, parseFlag, parsePositiveInt, runCli, shouldDryRun } from "./lib/cli";

const HELP = `Usage: npm run maintenance:retention -- [--dry-run|--execute] [day overrides]\n\nRuns all retention helpers for analytics events, AI invocation ledger rows,\naudit logs, terminal jobs, and expired account-admission records. Defaults to\ndry-run/count mode. Use --execute to delete or clear matched rows. Output is\nmetadata-only JSON counts.\n\nOptions:\n  --dry-run                 Count rows only (default)\n  --execute                 Delete matched rows after counting\n  --analytics-days <days>   Override ANALYTICS_RETENTION_DAYS for this run\n  --ai-days <days>          Override AI_LEDGER_RETENTION_DAYS for this run\n  --audit-days <days>       Override AUDIT_LOG_RETENTION_DAYS for this run\n  --jobs-days <days>        Override JOB_TERMINAL_RETENTION_DAYS for this run\n  --admission-days <days>   Override retention for terminal account invitations\n  --help, -h                Show this help\n`;

type CliIo = {
  log?: (message: string) => void;
  error?: (message: string) => void;
};

function parseOptions(argv: string[]): RetentionOptions | "help" {
  if (parseFlag(argv, "--help", "-h")) return "help";
  const defaults = retentionMaintenanceOptions(shouldDryRun(argv));
  return {
    dryRun: defaults.dryRun,
    analyticsDays: parsePositiveInt(
      argv,
      "--analytics-days",
      defaults.analyticsDays,
    ),
    aiDays: parsePositiveInt(argv, "--ai-days", defaults.aiDays),
    auditDays: parsePositiveInt(argv, "--audit-days", defaults.auditDays),
    jobsDays: parsePositiveInt(argv, "--jobs-days", defaults.jobsDays),
    admissionDays: parsePositiveInt(
      argv,
      "--admission-days",
      defaults.admissionDays,
    ),
  };
}

export async function retentionMaintenanceMain(argv = process.argv.slice(2), io: CliIo = {}): Promise<number> {
  const log = io.log ?? console.log;
  const error = io.error ?? console.error;
  const options = parseOptions(argv);
  if (options === "help") {
    log(HELP.trimEnd());
    return 0;
  }
  const result = await runRetentionMaintenance(options);
  log(JSON.stringify(result, null, 2));
  if (!result.executed) {
    error("Dry run only. Re-run with --execute to delete matched rows.");
  }
  return 0;
}

if (isMain(import.meta.url)) runCli(() => retentionMaintenanceMain());
