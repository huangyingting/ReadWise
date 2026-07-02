/**
 * Runtime readiness validation — composes all domain config checks (server-only).
 *
 * IMPORTANT: never import from a Client Component.
 */
import {
  envValue,
  evaluateOptional,
  evaluateRequired,
  httpUrlIssue,
  issue,
  type ConfigCheckReport,
  type ConfigIssue,
  type RuntimeConfigReport,
} from "@/lib/runtime-config/env";
import { isValidVapidSubject } from "@/lib/runtime-config/push";
import { azureStorageConfig } from "@/lib/runtime-config/storage";

const SUPPORTED_SPEECH_OUTPUT_FORMATS = new Set([
  "audio-16khz-32kbitrate-mono-mp3",
  "audio-16khz-128kbitrate-mono-mp3",
  "audio-24khz-48kbitrate-mono-mp3",
  "audio-24khz-96kbitrate-mono-mp3",
  "audio-48khz-96kbitrate-mono-mp3",
]);

function isValidDatabaseUrl(value: string): boolean {
  if (value.startsWith("file:")) {
    return value.length > "file:".length;
  }
  try {
    const { protocol } = new URL(value);
    return protocol === "postgresql:" || protocol === "postgres:";
  } catch {
    return false;
  }
}

function evaluateTuning(): ConfigCheckReport {
  const env = [
    "AI_REQUEST_TIMEOUT_MS",
    "AI_MAX_RETRIES",
    "SPEECH_TIMEOUT_MS",
    "RATE_LIMIT_AI_REQUESTS",
    "RATE_LIMIT_LOOKUP_REQUESTS",
    "RATE_LIMIT_PUBLIC_REQUESTS",
    "RATE_LIMIT_IMPORT_REQUESTS",
    "RATE_LIMIT_ADMIN_JOB_REQUESTS",
    "RATE_LIMIT_AUTH_REQUESTS",
    "RATE_LIMIT_WINDOW_MS",
    "LOG_LEVEL",
  ];
  const issues: ConfigIssue[] = [];

  const positiveInt = (name: string) => {
    const value = envValue(name);
    if (!value) return;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      issues.push(
        issue("warning", "invalid_positive_integer", `${name} must be a positive integer; default will be used.`, [name]),
      );
    }
  };
  positiveInt("AI_REQUEST_TIMEOUT_MS");
  positiveInt("SPEECH_TIMEOUT_MS");
  positiveInt("RATE_LIMIT_AI_REQUESTS");
  positiveInt("RATE_LIMIT_LOOKUP_REQUESTS");
  positiveInt("RATE_LIMIT_PUBLIC_REQUESTS");
  positiveInt("RATE_LIMIT_IMPORT_REQUESTS");
  positiveInt("RATE_LIMIT_ADMIN_JOB_REQUESTS");
  positiveInt("RATE_LIMIT_AUTH_REQUESTS");
  positiveInt("RATE_LIMIT_WINDOW_MS");

  const retries = envValue("AI_MAX_RETRIES");
  if (retries) {
    const parsed = Number(retries);
    if (!Number.isInteger(parsed) || parsed < 0) {
      issues.push(
        issue("warning", "invalid_nonnegative_integer", "AI_MAX_RETRIES must be a non-negative integer; default will be used.", [
          "AI_MAX_RETRIES",
        ]),
      );
    }
  }

  const level = envValue("LOG_LEVEL");
  if (level && !["debug", "info", "warn", "error"].includes(level.toLowerCase())) {
    issues.push(
      issue("warning", "invalid_log_level", "LOG_LEVEL must be one of debug, info, warn, or error; info will be used.", [
        "LOG_LEVEL",
      ]),
    );
  }

  return {
    status: issues.length ? "degraded" : "ok",
    configured: issues.length === 0,
    required: false,
    env,
    missing: [],
    issues,
  };
}

function validateRuntimeSections() {
  const database = evaluateRequired(["DATABASE_URL"], [
    (values) =>
      isValidDatabaseUrl(values.DATABASE_URL)
        ? null
        : issue("error", "invalid_database_url", "DATABASE_URL must be a SQLite file: URL or PostgreSQL URL.", [
            "DATABASE_URL",
          ]),
  ]);

  const auth = evaluateRequired(["NEXTAUTH_SECRET", "NEXTAUTH_URL"], [
    (values) =>
      /^(replace-with|your-|changeme|change-me)/i.test(values.NEXTAUTH_SECRET)
        ? issue("error", "placeholder_secret", "NEXTAUTH_SECRET must be replaced with a real random secret.", [
            "NEXTAUTH_SECRET",
          ])
        : null,
    (values) =>
      values.NEXTAUTH_SECRET.length < 32
        ? issue("error", "weak_secret", "NEXTAUTH_SECRET must be at least 32 characters.", ["NEXTAUTH_SECRET"])
        : null,
    (values) => httpUrlIssue("NEXTAUTH_URL", values.NEXTAUTH_URL),
  ]);

  const ai = evaluateOptional(
    ["AZURE_OPENAI_ENDPOINT", "AZURE_OPENAI_API_KEY", "AZURE_OPENAI_DEPLOYMENT", "AZURE_OPENAI_API_VERSION"],
    [
      (values) =>
        values.AZURE_OPENAI_ENDPOINT
          ? httpUrlIssue("AZURE_OPENAI_ENDPOINT", values.AZURE_OPENAI_ENDPOINT, "warning")
          : null,
      (values) =>
        values.AZURE_OPENAI_API_VERSION && !/^\d{4}-\d{2}-\d{2}(-preview)?$/.test(values.AZURE_OPENAI_API_VERSION)
          ? issue("warning", "invalid_api_version", "AZURE_OPENAI_API_VERSION should look like YYYY-MM-DD or YYYY-MM-DD-preview.", [
              "AZURE_OPENAI_API_VERSION",
            ])
          : null,
    ],
  );
  // AI_PROVIDER and AI_MODERATION_ENABLED are visible tuning knobs for this section.
  ai.env.push("AI_PROVIDER", "AI_MODERATION_ENABLED");

  const speech = evaluateOptional(["AZURE_SPEECH_KEY", "AZURE_SPEECH_REGION"], [
    (values) =>
      values.AZURE_SPEECH_REGION && !/^[a-z][a-z0-9-]*$/i.test(values.AZURE_SPEECH_REGION)
        ? issue("warning", "invalid_speech_region", "AZURE_SPEECH_REGION should be an Azure region slug such as eastus.", [
            "AZURE_SPEECH_REGION",
          ])
        : null,
    () => {
      const format = envValue("AZURE_SPEECH_OUTPUT_FORMAT");
      return format && !SUPPORTED_SPEECH_OUTPUT_FORMATS.has(format)
        ? issue("warning", "unsupported_speech_format", "AZURE_SPEECH_OUTPUT_FORMAT is unsupported; default mp3 output will be used.", [
            "AZURE_SPEECH_OUTPUT_FORMAT",
          ])
        : null;
    },
  ]);

  const push = evaluateOptional(["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"], [
    (values) =>
      values.VAPID_SUBJECT && !isValidVapidSubject(values.VAPID_SUBJECT)
        ? issue("warning", "invalid_vapid_subject", "VAPID_SUBJECT should be a mailto: address or URL.", ["VAPID_SUBJECT"])
        : null,
  ]);

  const googleOAuth = evaluateOptional(["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"]);
  const azureAdOAuth = evaluateOptional(["AZURE_AD_CLIENT_ID", "AZURE_AD_CLIENT_SECRET", "AZURE_AD_TENANT_ID"]);

  const storageModeRaw = (envValue("MEDIA_STORAGE") ?? "").toLowerCase();
  let storage: ConfigCheckReport;
  if (!storageModeRaw || storageModeRaw === "filesystem" || storageModeRaw === "local") {
    storage = {
      status: "configured",
      configured: true,
      required: false,
      env: ["MEDIA_STORAGE", "MEDIA_STORAGE_DIR"],
      missing: [],
      issues: [],
    };
  } else if (storageModeRaw === "azure") {
    const hasCreds = azureStorageConfig() !== null;
    if (hasCreds) {
      storage = {
        status: "configured",
        configured: true,
        required: false,
        env: ["MEDIA_STORAGE", "AZURE_STORAGE_CONNECTION_STRING", "AZURE_STORAGE_ACCOUNT", "AZURE_STORAGE_KEY", "AZURE_STORAGE_CONTAINER"],
        missing: [],
        issues: [],
      };
    } else {
      storage = {
        status: "degraded",
        configured: false,
        required: false,
        env: ["MEDIA_STORAGE", "AZURE_STORAGE_CONNECTION_STRING", "AZURE_STORAGE_ACCOUNT", "AZURE_STORAGE_KEY", "AZURE_STORAGE_CONTAINER"],
        missing: ["AZURE_STORAGE_CONNECTION_STRING or AZURE_STORAGE_ACCOUNT+AZURE_STORAGE_KEY"],
        issues: [
          issue(
            "warning",
            "azure_storage_creds_missing",
            "MEDIA_STORAGE=azure but credentials are missing; speech audio will not be persisted until Azure Storage is configured.",
            ["AZURE_STORAGE_CONNECTION_STRING", "AZURE_STORAGE_ACCOUNT", "AZURE_STORAGE_KEY"],
          ),
        ],
      };
    }
  } else if (storageModeRaw === "database") {
    storage = {
      status: "degraded",
      configured: true,
      required: false,
      env: ["MEDIA_STORAGE", "MEDIA_STORAGE_DIR"],
      missing: [],
      issues: [
        issue("warning", "database_storage_removed", "MEDIA_STORAGE=database is no longer supported; local filesystem storage will be used instead.", ["MEDIA_STORAGE"]),
      ],
    };
  } else {
    storage = {
      status: "degraded",
      configured: true,
      required: false,
      env: ["MEDIA_STORAGE", "MEDIA_STORAGE_DIR"],
      missing: [],
      issues: [
        issue("warning", "unknown_storage_kind", `MEDIA_STORAGE="${storageModeRaw}" is not a known backend; local filesystem storage will be used instead.`, ["MEDIA_STORAGE"]),
      ],
    };
  }

  const scraper = evaluateOptional(["SCRAPER_MAX_BYTES", "SCRAPER_TIMEOUT_MS", "SCRAPER_HTML_NORMALIZE"]);

  const tuning = evaluateTuning();

  return {
    required: { database, auth },
    optional: { ai, speech, push, googleOAuth, azureAdOAuth, storage, scraper },
    tuning,
  };
}

export function validateRuntimeConfig(): RuntimeConfigReport {
  const sections = validateRuntimeSections();
  const allChecks = [
    ...Object.values(sections.required),
    ...Object.values(sections.optional),
    sections.tuning,
  ];
  const errors = allChecks.flatMap((check) => check.issues.filter((item) => item.severity === "error"));
  const warnings = allChecks.flatMap((check) => check.issues.filter((item) => item.severity === "warning"));
  const ready = Object.values(sections.required).every((check) => check.configured);

  return {
    ...sections,
    ready,
    status: ready ? "ready" : "unavailable",
    checkedAt: new Date().toISOString(),
    errors,
    warnings,
  };
}
