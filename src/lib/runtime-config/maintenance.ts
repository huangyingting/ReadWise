import {
  defineFeatureConfig,
  envValue,
  issue,
  type ConfigCheckReport,
  type FeatureConfig,
} from "./env";

const RETENTION_WORKER_ENV = "RETENTION_WORKER_SECRET";
const MIN_SECRET_LENGTH = 32;

export type RetentionWorkerConfig = {
  secret: string;
};

function readRetentionWorkerConfig(): RetentionWorkerConfig | null {
  const secret = envValue(RETENTION_WORKER_ENV);
  if (!secret || secret.length < MIN_SECRET_LENGTH) return null;
  return { secret };
}

export const retentionWorkerConfig: FeatureConfig<RetentionWorkerConfig> =
  defineFeatureConfig(readRetentionWorkerConfig);

export function inspectRetentionWorkerConfig(): ConfigCheckReport {
  const secret = envValue(RETENTION_WORKER_ENV);
  if (!secret) {
    return {
      status: "unconfigured",
      configured: false,
      required: false,
      env: [RETENTION_WORKER_ENV],
      missing: [],
      issues: [],
    };
  }
  if (secret.length < MIN_SECRET_LENGTH) {
    return {
      status: "degraded",
      configured: false,
      required: false,
      env: [RETENTION_WORKER_ENV],
      missing: [],
      issues: [
        issue(
          "warning",
          "retention_worker_secret_too_short",
          "RETENTION_WORKER_SECRET must contain at least 32 characters.",
          [RETENTION_WORKER_ENV],
        ),
      ],
    };
  }
  return {
    status: "configured",
    configured: true,
    required: false,
    env: [RETENTION_WORKER_ENV],
    missing: [],
    issues: [],
  };
}
