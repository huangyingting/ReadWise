import {
  defineFeatureConfig,
  envValue,
  issue,
  type ConfigCheckReport,
  type FeatureConfig,
} from "./env";

const ACCOUNT_ADMISSION_ENV = "ACCOUNT_ADMISSION_MODE";
const ACCOUNT_ADMISSION_RETENTION_ENV = "ACCOUNT_ADMISSION_RETENTION_DAYS";
const ACCOUNT_MAIL_ENV = [
  "ACCOUNT_MAIL_WORKFLOW_ENABLED",
  "ACCOUNT_MAIL_WORKER_SECRET",
] as const;

export type AccountMailWorkflowConfig = {
  secret: string;
};

function readAccountMailWorkflowConfig(): AccountMailWorkflowConfig | null {
  const enabled = envValue(ACCOUNT_MAIL_ENV[0])?.toLowerCase();
  const secret = envValue(ACCOUNT_MAIL_ENV[1]);
  return enabled === "true" && secret ? { secret } : null;
}

export const accountMailWorkflowConfig: FeatureConfig<AccountMailWorkflowConfig> =
  defineFeatureConfig(readAccountMailWorkflowConfig);

export function inspectEmailDeliveryConfig(): ConfigCheckReport {
  const enabled = envValue(ACCOUNT_MAIL_ENV[0])?.toLowerCase();
  const secret = envValue(ACCOUNT_MAIL_ENV[1]);
  const configured = accountMailWorkflowConfig.get();
  const issues = [];

  if (enabled && enabled !== "true" && enabled !== "false") {
    issues.push(
      issue(
        "warning",
        "invalid_account_mail_workflow_flag",
        "ACCOUNT_MAIL_WORKFLOW_ENABLED must be true or false.",
        [ACCOUNT_MAIL_ENV[0]],
      ),
    );
  }
  if (enabled === "true" && !secret) {
    issues.push(
      issue(
        "warning",
        "missing_account_mail_worker_secret",
        "GitHub Actions account mail requires ACCOUNT_MAIL_WORKER_SECRET.",
        [...ACCOUNT_MAIL_ENV],
      ),
    );
  }
  if (secret && enabled !== "true") {
    issues.push(
      issue(
        "warning",
        "inactive_account_mail_worker_secret",
        "ACCOUNT_MAIL_WORKER_SECRET is set but the GitHub Actions account mail workflow is not enabled.",
        [...ACCOUNT_MAIL_ENV],
      ),
    );
  }

  return {
    status: configured
      ? issues.length
        ? "degraded"
        : "configured"
      : enabled || secret
        ? "degraded"
        : "unconfigured",
    configured: configured !== null,
    required: false,
    env: [...ACCOUNT_MAIL_ENV],
    missing: [],
    issues,
  };
}

export function accountAdmissionRetentionDays(): number {
  const raw = Number(envValue(ACCOUNT_ADMISSION_RETENTION_ENV));
  return Number.isInteger(raw) && raw > 0 ? raw : 90;
}

export function inspectAccountAdmissionConfig(): ConfigCheckReport {
  const raw = envValue(ACCOUNT_ADMISSION_ENV);
  const mode = raw?.toLowerCase() ?? "invitation-only";
  const retentionRaw = envValue(ACCOUNT_ADMISSION_RETENTION_ENV);
  const retentionValue = Number(retentionRaw);
  const retentionIssue =
    retentionRaw &&
    (!Number.isInteger(retentionValue) || retentionValue <= 0)
      ? issue(
          "warning",
          "invalid_account_admission_retention",
          "ACCOUNT_ADMISSION_RETENTION_DAYS must be a positive integer; 90 days will be used.",
          [ACCOUNT_ADMISSION_RETENTION_ENV],
        )
      : null;

  if (mode !== "invitation-only" && mode !== "public") {
    return {
      status: "malformed",
      configured: false,
      required: true,
      env: [
        ACCOUNT_ADMISSION_ENV,
        ACCOUNT_ADMISSION_RETENTION_ENV,
        ...ACCOUNT_MAIL_ENV,
      ],
      missing: [],
      issues: [
        issue(
          "error",
          "invalid_account_admission_mode",
          "ACCOUNT_ADMISSION_MODE must be invitation-only or public.",
          [ACCOUNT_ADMISSION_ENV],
        ),
        ...(retentionIssue ? [retentionIssue] : []),
      ],
    };
  }

  if (mode === "public" && !accountMailWorkflowConfig.isConfigured()) {
    return {
      status: "degraded",
      configured: false,
      required: true,
      env: [
        ACCOUNT_ADMISSION_ENV,
        ACCOUNT_ADMISSION_RETENTION_ENV,
        ...ACCOUNT_MAIL_ENV,
      ],
      missing: [],
      issues: [
        issue(
          "warning",
          "public_registration_email_unavailable",
          "Public registration requires the GitHub Actions account mail workflow.",
          [...ACCOUNT_MAIL_ENV],
        ),
        ...(retentionIssue ? [retentionIssue] : []),
      ],
    };
  }

  return {
    status: retentionIssue ? "degraded" : "configured",
    configured: retentionIssue === null,
    required: true,
    env: [
      ACCOUNT_ADMISSION_ENV,
      ACCOUNT_ADMISSION_RETENTION_ENV,
      ...ACCOUNT_MAIL_ENV,
    ],
    missing: [],
    issues: retentionIssue ? [retentionIssue] : [],
  };
}
