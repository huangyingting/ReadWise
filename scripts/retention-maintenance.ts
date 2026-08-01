import { countOldAiInvocations, pruneOldAiInvocations } from "@/lib/ai/retention";
import { countOldEvents, pruneOldEvents } from "@/lib/analytics/events/retention";
import { countTerminalJobs, JOB_TERMINAL_STATUSES, pruneTerminalJobs } from "@/lib/jobs/retention";
import { countOldAuditLogs, pruneOldAuditLogs } from "@/lib/security/audit";
import { aiLedgerRetentionDays } from "@/lib/runtime-config/ai";
import { analyticsRetentionDays } from "@/lib/runtime-config/analytics";
import { auditLogRetentionDays } from "@/lib/runtime-config/security";
import { jobTerminalRetentionDays } from "@/lib/jobs/retention";
import { isMain, parseFlag, parsePositiveInt, runCli, shouldDryRun } from "./lib/cli";

const HELP = `Usage: npm run maintenance:retention -- [--dry-run|--execute] [day overrides]\n\nRuns all retention helpers for analytics events, AI invocation ledger rows,\naudit logs, and terminal jobs. Defaults to dry-run/count mode. Use --execute\nto delete matched rows. Output is metadata-only JSON counts.\n\nOptions:\n  --dry-run                 Count rows only (default)\n  --execute                 Delete matched rows after counting\n  --analytics-days <days>   Override ANALYTICS_RETENTION_DAYS for this run\n  --ai-days <days>          Override AI_LEDGER_RETENTION_DAYS for this run\n  --audit-days <days>       Override AUDIT_LOG_RETENTION_DAYS for this run\n  --jobs-days <days>        Override JOB_TERMINAL_RETENTION_DAYS for this run\n  --help, -h                Show this help\n`;

type MaintenanceArea = "analytics" | "ai" | "audit" | "jobs";

type RetentionOptions = {
  dryRun: boolean;
  analyticsDays: number;
  aiDays: number;
  auditDays: number;
  jobsDays: number;
};

export type RetentionResult = {
  area: MaintenanceArea;
  retentionDays: number;
  matched: number;
  deleted: number;
};

export type RetentionRunResult = {
  dryRun: boolean;
  executed: boolean;
  results: RetentionResult[];
};

type CliIo = {
  log?: (message: string) => void;
  error?: (message: string) => void;
};

function parseOptions(argv: string[]): RetentionOptions | "help" {
  if (parseFlag(argv, "--help", "-h")) return "help";
  return {
    dryRun: shouldDryRun(argv),
    analyticsDays: parsePositiveInt(argv, "--analytics-days", analyticsRetentionDays()),
    aiDays: parsePositiveInt(argv, "--ai-days", aiLedgerRetentionDays()),
    auditDays: parsePositiveInt(argv, "--audit-days", auditLogRetentionDays()),
    jobsDays: parsePositiveInt(argv, "--jobs-days", jobTerminalRetentionDays()),
  };
}

async function runArea(
  area: MaintenanceArea,
  retentionDays: number,
  dryRun: boolean,
  count: (days: number) => Promise<number>,
  prune: (days: number) => Promise<number>,
): Promise<RetentionResult> {
  const matched = await count(retentionDays);
  const deleted = dryRun ? 0 : await prune(retentionDays);
  return { area, retentionDays, matched, deleted };
}

export async function runRetentionMaintenance(options: RetentionOptions): Promise<RetentionRunResult> {
  const results = await Promise.all([
    runArea("analytics", options.analyticsDays, options.dryRun, countOldEvents, pruneOldEvents),
    runArea("ai", options.aiDays, options.dryRun, countOldAiInvocations, pruneOldAiInvocations),
    runArea("audit", options.auditDays, options.dryRun, countOldAuditLogs, pruneOldAuditLogs),
    runArea(
      "jobs",
      options.jobsDays,
      options.dryRun,
      (days) => countTerminalJobs(days, JOB_TERMINAL_STATUSES),
      (days) => pruneTerminalJobs(days, JOB_TERMINAL_STATUSES),
    ),
  ]);
  return { dryRun: options.dryRun, executed: !options.dryRun, results };
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
