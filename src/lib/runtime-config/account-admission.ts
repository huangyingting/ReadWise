import {
  defineFeatureConfig,
  envValue,
  issue,
  type ConfigCheckReport,
  type FeatureConfig,
} from "./env";

const ACCOUNT_ADMISSION_ENV = "ACCOUNT_ADMISSION_MODE";
const ACCOUNT_ADMISSION_RETENTION_ENV = "ACCOUNT_ADMISSION_RETENTION_DAYS";
const EMAIL_DELIVERY_ENV = ["SMTP_URL", "EMAIL_FROM"] as const;

export type EmailDeliveryConfig = {
  smtpUrl: string;
  from: string;
};

function readEmailDeliveryConfig(): EmailDeliveryConfig | null {
  const smtpUrl = envValue(EMAIL_DELIVERY_ENV[0]);
  const from = envValue(EMAIL_DELIVERY_ENV[1]);
  if (!smtpUrl || !from) return null;
  return { smtpUrl, from };
}

export const emailDeliveryConfig: FeatureConfig<EmailDeliveryConfig> =
  defineFeatureConfig(readEmailDeliveryConfig);

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
        ...EMAIL_DELIVERY_ENV,
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

  if (mode === "public" && !emailDeliveryConfig.isConfigured()) {
    return {
      status: "degraded",
      configured: false,
      required: true,
      env: [
        ACCOUNT_ADMISSION_ENV,
        ACCOUNT_ADMISSION_RETENTION_ENV,
        ...EMAIL_DELIVERY_ENV,
      ],
      missing: EMAIL_DELIVERY_ENV.filter((name) => !envValue(name)),
      issues: [
        issue(
          "warning",
          "public_registration_email_unavailable",
          "Public registration requires email delivery; configure SMTP_URL and EMAIL_FROM.",
          [...EMAIL_DELIVERY_ENV],
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
      ...EMAIL_DELIVERY_ENV,
    ],
    missing: [],
    issues: retentionIssue ? [retentionIssue] : [],
  };
}
