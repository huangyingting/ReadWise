import { countOldAiInvocations, pruneOldAiInvocations } from "@/lib/ai/retention";
import { countOldEvents, pruneOldEvents } from "@/lib/analytics/events/retention";
import {
  countExpiredAccountAdmissionData,
  pruneExpiredAccountAdmissionData,
} from "@/lib/account-admission/retention";
import {
  countTerminalJobs,
  JOB_TERMINAL_STATUSES,
  pruneTerminalJobs,
} from "@/lib/jobs/retention";
import { countOldAuditLogs, pruneOldAuditLogs } from "@/lib/security/audit";
import { aiLedgerRetentionDays } from "@/lib/runtime-config/ai";
import { analyticsRetentionDays } from "@/lib/runtime-config/analytics";
import { accountAdmissionRetentionDays } from "@/lib/runtime-config/account-admission";
import { auditLogRetentionDays } from "@/lib/runtime-config/security";
import { jobTerminalRetentionDays } from "@/lib/jobs/retention";

export type MaintenanceArea =
  | "analytics"
  | "ai"
  | "audit"
  | "jobs"
  | "account-admission";

export type RetentionOptions = {
  dryRun: boolean;
  analyticsDays: number;
  aiDays: number;
  auditDays: number;
  jobsDays: number;
  admissionDays: number;
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

export function retentionMaintenanceOptions(
  dryRun: boolean,
): RetentionOptions {
  return {
    dryRun,
    analyticsDays: analyticsRetentionDays(),
    aiDays: aiLedgerRetentionDays(),
    auditDays: auditLogRetentionDays(),
    jobsDays: jobTerminalRetentionDays(),
    admissionDays: accountAdmissionRetentionDays(),
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

export async function runRetentionMaintenance(
  options: RetentionOptions,
): Promise<RetentionRunResult> {
  const results = await Promise.all([
    runArea(
      "analytics",
      options.analyticsDays,
      options.dryRun,
      countOldEvents,
      pruneOldEvents,
    ),
    runArea(
      "ai",
      options.aiDays,
      options.dryRun,
      countOldAiInvocations,
      pruneOldAiInvocations,
    ),
    runArea(
      "audit",
      options.auditDays,
      options.dryRun,
      countOldAuditLogs,
      pruneOldAuditLogs,
    ),
    runArea(
      "jobs",
      options.jobsDays,
      options.dryRun,
      (days) => countTerminalJobs(days, JOB_TERMINAL_STATUSES),
      (days) => pruneTerminalJobs(days, JOB_TERMINAL_STATUSES),
    ),
    runArea(
      "account-admission",
      options.admissionDays,
      options.dryRun,
      countExpiredAccountAdmissionData,
      pruneExpiredAccountAdmissionData,
    ),
  ]);
  return { dryRun: options.dryRun, executed: !options.dryRun, results };
}
