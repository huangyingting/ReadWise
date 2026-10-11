import { createPrivateKey } from "node:crypto";
import {
  defineFeatureConfig,
  envValue,
  issue,
  type ConfigCheckReport,
  type FeatureConfig,
} from "./env";

const ACCOUNT_ADMISSION_ENV = "ACCOUNT_ADMISSION_MODE";
const ACCOUNT_ADMISSION_RETENTION_ENV = "ACCOUNT_ADMISSION_RETENTION_DAYS";
const SMTP_EMAIL_ENV = ["SMTP_URL", "EMAIL_FROM"] as const;
const DIRECT_EMAIL_ENV = [
  "ACCOUNT_MAIL_FROM",
  "ACCOUNT_MAIL_DKIM_SELECTOR",
  "ACCOUNT_MAIL_DKIM_PRIVATE_KEY_BASE64",
] as const;
const EMAIL_DELIVERY_ENV = [...SMTP_EMAIL_ENV, ...DIRECT_EMAIL_ENV] as const;

export type SmtpEmailDeliveryConfig = {
  kind: "smtp";
  smtpUrl: string;
  from: string;
};

export type DirectEmailDeliveryConfig = {
  kind: "direct";
  from: string;
  selector: string;
  privateKey: string;
};

export type EmailDeliveryConfig =
  | SmtpEmailDeliveryConfig
  | DirectEmailDeliveryConfig;

function readDirectPrivateKey(): string | null {
  const encoded = envValue("ACCOUNT_MAIL_DKIM_PRIVATE_KEY_BASE64");
  if (!encoded) return null;
  try {
    const privateKey = Buffer.from(encoded, "base64").toString("utf8").trim();
    const key = createPrivateKey(privateKey);
    if (
      key.asymmetricKeyType !== "rsa" ||
      (key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048
    ) {
      return null;
    }
    return privateKey;
  } catch {
    return null;
  }
}

function validSmtpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "smtp:" || url.protocol === "smtps:";
  } catch {
    return false;
  }
}

function readEmailDeliveryConfig(): EmailDeliveryConfig | null {
  const directFrom = envValue(DIRECT_EMAIL_ENV[0]);
  const selector = envValue(DIRECT_EMAIL_ENV[1]);
  const privateKey = readDirectPrivateKey();
  if (
    directFrom &&
    /^[^@\s]+@[^@\s]+$/.test(directFrom) &&
    selector &&
    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(selector) &&
    privateKey
  ) {
    return {
      kind: "direct",
      from: directFrom.toLowerCase(),
      selector,
      privateKey,
    };
  }

  const smtpUrl = envValue(SMTP_EMAIL_ENV[0]);
  const from = envValue(SMTP_EMAIL_ENV[1]);
  if (!smtpUrl || !from || !validSmtpUrl(smtpUrl)) return null;
  return { kind: "smtp", smtpUrl, from };
}

export const emailDeliveryConfig: FeatureConfig<EmailDeliveryConfig> =
  defineFeatureConfig(readEmailDeliveryConfig);

export function inspectEmailDeliveryConfig(): ConfigCheckReport {
  const directValues = DIRECT_EMAIL_ENV.map((name) => envValue(name));
  const smtpValues = SMTP_EMAIL_ENV.map((name) => envValue(name));
  const directPresent = directValues.some(Boolean);
  const smtpPresent = smtpValues.some(Boolean);
  const configured = emailDeliveryConfig.get();
  const issues = [];

  if (directPresent && configured?.kind !== "direct") {
    issues.push(
      issue(
        "warning",
        "invalid_direct_email_config",
        "Direct account email requires a sender address, DKIM selector, and base64-encoded 2048-bit RSA private key.",
        [...DIRECT_EMAIL_ENV],
      ),
    );
  }

  if (smtpPresent) {
    const smtpUrl = smtpValues[0];
    if (!smtpUrl || !smtpValues[1]) {
      issues.push(
        issue(
          "warning",
          "incomplete_smtp_config",
          "SMTP email requires both SMTP_URL and EMAIL_FROM.",
          [...SMTP_EMAIL_ENV],
        ),
      );
    } else {
      if (!validSmtpUrl(smtpUrl)) {
        issues.push(
          issue(
            "warning",
            "invalid_smtp_url",
            "SMTP_URL must be a valid smtp or smtps URL.",
            ["SMTP_URL"],
          ),
        );
      }
    }
  }

  return {
    status: configured
      ? issues.length
        ? "degraded"
        : "configured"
      : directPresent || smtpPresent
        ? "degraded"
        : "unconfigured",
    configured: configured !== null,
    required: false,
    env: [...EMAIL_DELIVERY_ENV],
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
      missing: [],
      issues: [
        issue(
          "warning",
          "public_registration_email_unavailable",
          "Public registration requires either direct DKIM account mail or SMTP delivery.",
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
