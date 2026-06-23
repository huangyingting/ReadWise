/**
 * Centralized, typed runtime configuration (server-only).
 *
 * Single source of truth for the AI / Speech / Push / RateLimit / Log server
 * environment surface. Each multi-variable feature is exposed via the
 * {@link defineFeatureConfig} helper, which returns `{ get, isConfigured }`
 * following the project's graceful-fallback convention: `get()` returns a fully
 * typed config object when every required env var is present, else `null`.
 *
 * Scalar settings (AI timeout/retries, rate-limit numbers + window, log level)
 * are exposed as small accessor functions that read the current env on each
 * call and apply the existing defaults.
 *
 * IMPORTANT: never import this from a Client Component or the service worker
 * (it reads process.env at runtime). Keep optional providers graceful: invalid
 * or incomplete optional config should disable/degrade that feature, not crash
 * the app.
 */

/** A configured-or-null view over a multi-variable feature's environment. */
export type FeatureConfig<T> = {
  /** The typed config object, or `null` when any required var is missing. */
  get(): T | null;
  /** Whether every required env var for this feature is present. */
  isConfigured(): boolean;
};

export type ConfigIssue = {
  severity: "error" | "warning";
  code: string;
  message: string;
  env: string[];
};

export type ConfigCheckStatus =
  | "ok"
  | "missing"
  | "malformed"
  | "configured"
  | "unconfigured"
  | "degraded";

export type ConfigCheckReport = {
  status: ConfigCheckStatus;
  configured: boolean;
  required: boolean;
  env: string[];
  missing: string[];
  issues: ConfigIssue[];
};

export type RuntimeConfigReport = {
  ready: boolean;
  status: "ready" | "unavailable";
  checkedAt: string;
  required: {
    database: ConfigCheckReport;
    auth: ConfigCheckReport;
  };
  optional: {
    ai: ConfigCheckReport;
    speech: ConfigCheckReport;
    push: ConfigCheckReport;
    googleOAuth: ConfigCheckReport;
    azureAdOAuth: ConfigCheckReport;
  };
  tuning: ConfigCheckReport;
  errors: ConfigIssue[];
  warnings: ConfigIssue[];
};

/** Wraps a `read` function into a {@link FeatureConfig}. */
function defineFeatureConfig<T>(read: () => T | null): FeatureConfig<T> {
  return {
    get: read,
    isConfigured: () => read() !== null,
  };
}

function envValue(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function issue(
  severity: ConfigIssue["severity"],
  code: string,
  message: string,
  env: string[],
): ConfigIssue {
  return { severity, code, message, env };
}

function httpUrlIssue(
  name: string,
  value: string,
  severity: ConfigIssue["severity"] = "error",
): ConfigIssue | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return issue(severity, "invalid_url_protocol", `${name} must use http or https.`, [name]);
    }
    return null;
  } catch {
    return issue(severity, "invalid_url", `${name} must be a valid URL.`, [name]);
  }
}

function evaluateRequired(
  env: string[],
  validators: Array<(values: Record<string, string>) => ConfigIssue | null>,
): ConfigCheckReport {
  const values = Object.fromEntries(env.map((name) => [name, envValue(name)]));
  const missing = env.filter((name) => !values[name]);
  const issues = missing.length
    ? [
        issue(
          "error",
          "missing_required_env",
          `Missing required environment variable${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}.`,
          missing,
        ),
      ]
    : validators.flatMap((validate) => {
        const result = validate(values as Record<string, string>);
        return result ? [result] : [];
      });
  const hasErrors = issues.some((item) => item.severity === "error");
  return {
    status: missing.length ? "missing" : hasErrors ? "malformed" : "ok",
    configured: missing.length === 0 && !hasErrors,
    required: true,
    env,
    missing,
    issues,
  };
}

function evaluateOptional(
  env: string[],
  validators: Array<(values: Record<string, string>) => ConfigIssue | null> = [],
): ConfigCheckReport {
  const values = Object.fromEntries(env.map((name) => [name, envValue(name)]));
  const present = env.filter((name) => values[name]);
  const missing = env.filter((name) => !values[name]);

  if (present.length === 0) {
    return {
      status: "unconfigured",
      configured: false,
      required: false,
      env,
      missing: [],
      issues: [],
    };
  }

  const issues: ConfigIssue[] = [];
  if (missing.length > 0) {
    issues.push(
      issue(
        "warning",
        "partial_optional_provider",
        `Optional provider is partially configured; missing ${missing.join(", ")}.`,
        missing,
      ),
    );
  }

  issues.push(
    ...validators.flatMap((validate) => {
      const result = validate(values as Record<string, string>);
      return result ? [result] : [];
    }),
  );

  const degraded = missing.length > 0 || issues.length > 0;
  return {
    status: degraded ? "degraded" : "configured",
    configured: !degraded,
    required: false,
    env,
    missing,
    issues,
  };
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

const SUPPORTED_SPEECH_OUTPUT_FORMATS = new Set([
  "audio-16khz-32kbitrate-mono-mp3",
  "audio-16khz-128kbitrate-mono-mp3",
  "audio-24khz-48kbitrate-mono-mp3",
  "audio-24khz-96kbitrate-mono-mp3",
  "audio-48khz-96kbitrate-mono-mp3",
]);

function isValidVapidSubject(subject: string): boolean {
  return /^(mailto:[^@\s]+@[^@\s]+\.[^@\s]+|https?:\/\/.+)/i.test(subject);
}

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
  const tuning = evaluateTuning();

  return {
    required: { database, auth },
    optional: { ai, speech, push, googleOAuth, azureAdOAuth },
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

// ---------------------------------------------------------------------------
// Azure OpenAI (chat completions)
// ---------------------------------------------------------------------------

export type AiConfig = {
  endpoint: string;
  apiKey: string;
  deployment: string;
  apiVersion: string;
};

/** Azure OpenAI chat-completions config (endpoint trailing slashes stripped). */
export const aiConfig: FeatureConfig<AiConfig> = defineFeatureConfig(() => {
  const endpoint = envValue("AZURE_OPENAI_ENDPOINT")?.replace(/\/+$/, "");
  const apiKey = envValue("AZURE_OPENAI_API_KEY");
  const deployment = envValue("AZURE_OPENAI_DEPLOYMENT");
  const apiVersion = envValue("AZURE_OPENAI_API_VERSION");
  if (!endpoint || !apiKey || !deployment || !apiVersion) {
    return null;
  }
  return { endpoint, apiKey, deployment, apiVersion };
});

const DEFAULT_AI_TIMEOUT_MS = 30_000;
const DEFAULT_AI_MAX_RETRIES = 2;

/** Per-request AI timeout in ms (AI_REQUEST_TIMEOUT_MS, default 30000). */
export function aiTimeoutMs(): number {
  const v = parseInt(process.env.AI_REQUEST_TIMEOUT_MS ?? "", 10);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_AI_TIMEOUT_MS;
}

/** Max AI retry attempts (AI_MAX_RETRIES, default 2). */
export function aiMaxRetries(): number {
  const v = parseInt(process.env.AI_MAX_RETRIES ?? "", 10);
  return Number.isFinite(v) && v >= 0 ? v : DEFAULT_AI_MAX_RETRIES;
}

// ---------------------------------------------------------------------------
// AI invocation ledger + cost estimation (RW-019)
// ---------------------------------------------------------------------------

/**
 * Per-1K-token USD rates used to estimate AI invocation cost for the ledger.
 * `byModel` keys are matched case-insensitively as substrings of the model /
 * deployment name (e.g. a "gpt-4o" key matches deployment "my-gpt-4o-prod").
 * Defaults are intentionally conservative; override per deployment via env.
 *
 * Env:
 *   AI_COST_PROMPT_PER_1K      — default prompt rate     (default 0.00015)
 *   AI_COST_COMPLETION_PER_1K  — default completion rate (default 0.0006)
 *   AI_COST_RATES              — optional JSON map, e.g.
 *     {"gpt-4o":{"prompt":0.0025,"completion":0.01}}
 */
export type AiCostRate = { prompt: number; completion: number };
export type AiCostConfig = { default: AiCostRate; byModel: Record<string, AiCostRate> };

const DEFAULT_AI_COST_PROMPT_PER_1K = 0.00015;
const DEFAULT_AI_COST_COMPLETION_PER_1K = 0.0006;

function nonNegativeFloatEnv(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v >= 0 ? v : fallback;
}

function parseCostRateMap(raw: string | undefined): Record<string, AiCostRate> {
  if (!raw || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, AiCostRate> = {};
    for (const [model, value] of Object.entries(parsed)) {
      if (value && typeof value === "object") {
        const rate = value as { prompt?: unknown; completion?: unknown };
        const prompt = Number(rate.prompt);
        const completion = Number(rate.completion);
        if (Number.isFinite(prompt) && prompt >= 0 && Number.isFinite(completion) && completion >= 0) {
          out[model.toLowerCase()] = { prompt, completion };
        }
      }
    }
    return out;
  } catch {
    return {};
  }
}

/** Resolved per-1K-token cost rates (default + optional per-model overrides). */
export function aiCostConfig(): AiCostConfig {
  return {
    default: {
      prompt: nonNegativeFloatEnv("AI_COST_PROMPT_PER_1K", DEFAULT_AI_COST_PROMPT_PER_1K),
      completion: nonNegativeFloatEnv("AI_COST_COMPLETION_PER_1K", DEFAULT_AI_COST_COMPLETION_PER_1K),
    },
    byModel: parseCostRateMap(process.env.AI_COST_RATES),
  };
}

/**
 * Whether the AI invocation ledger persists records to the database.
 * Defaults OFF under NODE_ENV=test (unit tests mock prisma and opt in via
 * AI_LEDGER_ENABLED=1) and ON otherwise. Set AI_LEDGER_ENABLED=0 to disable.
 */
export function aiLedgerEnabled(): boolean {
  const raw = (process.env.AI_LEDGER_ENABLED ?? "").trim().toLowerCase();
  if (raw === "1" || raw === "true") return true;
  if (raw === "0" || raw === "false") return false;
  return process.env.NODE_ENV !== "test";
}

// ---------------------------------------------------------------------------
// Azure Speech (TTS)
// ---------------------------------------------------------------------------

export type SpeechConfig = {
  key: string;
  region: string;
  voice: string;
  format: string;
};

/** Default synthesis voice when AZURE_SPEECH_VOICE is unset. */
export const DEFAULT_SPEECH_VOICE = "en-US-AndrewMultilingualNeural";
const DEFAULT_SPEECH_OUTPUT_FORMAT = "audio-24khz-96kbitrate-mono-mp3";
const DEFAULT_SPEECH_TIMEOUT_MS = 30_000;

/**
 * Per-synthesis Azure Speech timeout in ms (SPEECH_TIMEOUT_MS, default 30000).
 * NaN-guarded so a malformed env can't yield `setTimeout(reject, NaN)` (which
 * fires immediately and fails every TTS request).
 */
export function speechTimeoutMs(): number {
  const v = parseInt(process.env.SPEECH_TIMEOUT_MS ?? "", 10);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_SPEECH_TIMEOUT_MS;
}

/** Azure Speech config; voice/format fall back to project defaults. */
export const speechConfig: FeatureConfig<SpeechConfig> = defineFeatureConfig(
  () => {
    const key = envValue("AZURE_SPEECH_KEY");
    const region = envValue("AZURE_SPEECH_REGION");
    if (!key || !region) {
      return null;
    }
    return {
      key,
      region,
      voice: envValue("AZURE_SPEECH_VOICE") || DEFAULT_SPEECH_VOICE,
      format:
        envValue("AZURE_SPEECH_OUTPUT_FORMAT") || DEFAULT_SPEECH_OUTPUT_FORMAT,
    };
  },
);

// ---------------------------------------------------------------------------
// Web Push / VAPID
// ---------------------------------------------------------------------------

export type PushConfig = {
  publicKey: string;
  privateKey: string;
  subject: string;
};

/** VAPID config for web-push (all three values trimmed). */
export const pushConfig: FeatureConfig<PushConfig> = defineFeatureConfig(() => {
  const publicKey = envValue("VAPID_PUBLIC_KEY");
  const privateKey = envValue("VAPID_PRIVATE_KEY");
  const subject = envValue("VAPID_SUBJECT");
  if (!publicKey || !privateKey || !subject) {
    return null;
  }
  if (!isValidVapidSubject(subject)) {
    return null;
  }
  return { publicKey, privateKey, subject };
});

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

const DEFAULT_RATE_LIMIT_AI = 20;
const DEFAULT_RATE_LIMIT_LOOKUP = 60;
const DEFAULT_RATE_LIMIT_PUBLIC = 30;
const DEFAULT_RATE_LIMIT_IMPORT = 10;
const DEFAULT_RATE_LIMIT_ADMIN_JOB = 30;
const DEFAULT_RATE_LIMIT_AUTH = 10;
const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;

function positiveIntEnv(name: string, fallback: number): number {
  const v = parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

/** Max requests per key per window for the "ai" scope (default 20). */
export function rateLimitAiRequests(): number {
  return positiveIntEnv("RATE_LIMIT_AI_REQUESTS", DEFAULT_RATE_LIMIT_AI);
}

/** Max requests per key per window for the "lookup" scope (default 60). */
export function rateLimitLookupRequests(): number {
  return positiveIntEnv("RATE_LIMIT_LOOKUP_REQUESTS", DEFAULT_RATE_LIMIT_LOOKUP);
}

/** Max requests per key per window for the "public" scope (default 30). */
export function rateLimitPublicRequests(): number {
  return positiveIntEnv("RATE_LIMIT_PUBLIC_REQUESTS", DEFAULT_RATE_LIMIT_PUBLIC);
}

/** Max requests per key per window for the "import" scope (default 10). */
export function rateLimitImportRequests(): number {
  return positiveIntEnv("RATE_LIMIT_IMPORT_REQUESTS", DEFAULT_RATE_LIMIT_IMPORT);
}

/** Max requests per key per window for the "admin-job" scope (default 30). */
export function rateLimitAdminJobRequests(): number {
  return positiveIntEnv("RATE_LIMIT_ADMIN_JOB_REQUESTS", DEFAULT_RATE_LIMIT_ADMIN_JOB);
}

/** Max requests per key per window for the "auth" scope (default 10). */
export function rateLimitAuthRequests(): number {
  return positiveIntEnv("RATE_LIMIT_AUTH_REQUESTS", DEFAULT_RATE_LIMIT_AUTH);
}

/** Rate-limit window length in ms (RATE_LIMIT_WINDOW_MS, default 60000). */
export function rateLimitWindowMs(): number {
  return positiveIntEnv("RATE_LIMIT_WINDOW_MS", DEFAULT_RATE_LIMIT_WINDOW_MS);
}

export type RateLimitStoreMode = "auto" | "database" | "memory";

/**
 * Backing store for the shared rate limiter (RATE_LIMIT_STORE, default "auto").
 *   - "auto"     — use the DB-backed shared store, falling back to in-memory on
 *                  any store error (graceful degradation for dev / tests).
 *   - "database" — always use the DB store (still falls back to memory on error).
 *   - "memory"   — never touch the DB; use the process-local limiter only.
 */
export function rateLimitStoreMode(): RateLimitStoreMode {
  const raw = (process.env.RATE_LIMIT_STORE ?? "").trim().toLowerCase();
  if (raw === "database" || raw === "memory" || raw === "auto") return raw;
  // Default to the shared DB store in dev/prod; pure in-memory under tests so
  // the suite never needs a live DB (a dedicated test opts in via the env var).
  return process.env.NODE_ENV === "test" ? "memory" : "auto";
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

export type LogLevel = "debug" | "info" | "warn" | "error";

/** The configured log level (LOG_LEVEL, default "info"). */
export function logLevel(): LogLevel {
  const raw = (process.env.LOG_LEVEL ?? "").toLowerCase();
  if (raw === "debug" || raw === "info" || raw === "warn" || raw === "error") {
    return raw;
  }
  return "info";
}
