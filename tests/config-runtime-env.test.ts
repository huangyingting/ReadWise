process.env.LOG_LEVEL = "error";

import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

const ENV_KEYS = [
  "AI_MAX_RETRIES",
  "AI_REQUEST_TIMEOUT_MS",
  "ANALYTICS_ENABLED",
  "ANALYTICS_RETENTION_DAYS",
  "APP_URL",
  "APP_VERSION",
  "AUDIT_LOG_RETENTION_DAYS",
  "AZURE_SPEECH_KEY",
  "AZURE_SPEECH_OUTPUT_FORMAT",
  "AZURE_SPEECH_REGION",
  "AZURE_SPEECH_VOICE",
  "AZURE_STORAGE_ACCOUNT",
  "AZURE_STORAGE_CONNECTION_STRING",
  "AZURE_STORAGE_CONTAINER",
  "AZURE_STORAGE_KEY",
  "CSRF_ALLOWED_ORIGINS",
  "CSRF_ENFORCE",
  "DATABASE_URL",
  "DICTIONARY_PROVIDER",
  "ERROR_ALERT_THRESHOLD",
  "ERROR_REPORTING_PROVIDER",
  "LOCAL_DICTIONARY_DIR",
  "LOCAL_DICTIONARY_LANGUAGE",
  "LOG_LEVEL",
  "MEDIA_STORAGE",
  "MEDIA_STORAGE_DIR",
  "NEXT_PUBLIC_APP_URL",
  "NEXTAUTH_SECRET",
  "NEXTAUTH_URL",
  "NODE_ENV",
  "OTEL_EXPORTER_OTLP_ENDPOINT",
  "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
  "OTEL_SERVICE_NAME",
  "RATE_LIMIT_ADMIN_JOB_REQUESTS",
  "RATE_LIMIT_AI_REQUESTS",
  "RATE_LIMIT_AUTH_REQUESTS",
  "RATE_LIMIT_IMPORT_REQUESTS",
  "RATE_LIMIT_LOOKUP_REQUESTS",
  "RATE_LIMIT_PUBLIC_REQUESTS",
  "RATE_LIMIT_STORE",
  "RATE_LIMIT_WINDOW_MS",
  "SECURITY_EVENT_ALERT_THRESHOLD",
  "SECURITY_EVENT_BUFFER_SIZE",
  "SECURITY_EVENT_WINDOW_MS",
  "SPEECH_TIMEOUT_MS",
  "TRACING_ENABLED",
  "TRUSTED_PROXY_HEADER",
  "TRUSTED_PROXY_HOPS",
  "TRUSTED_PROXY_LIST",
  "npm_package_version",
] as const;

let savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>;
const mutableEnv = process.env as Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = {};
  for (const key of ENV_KEYS) {
    savedEnv[key] = mutableEnv[key];
    delete mutableEnv[key];
  }
  mutableEnv.LOG_LEVEL = "error";
  mutableEnv.NODE_ENV = "test";
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = savedEnv[key];
    if (value === undefined) delete mutableEnv[key];
    else mutableEnv[key] = value;
  }
});

function setRequiredRuntimeEnv() {
  process.env.DATABASE_URL = "file:./dev.db";
  process.env.NEXTAUTH_SECRET = "12345678901234567890123456789012";
  process.env.NEXTAUTH_URL = "http://localhost:3000";
}

test("observability config resolves defaults, tracing, and thresholds", async () => {
  const {
    appVersion,
    errorAlertThreshold,
    errorReportingProvider,
    isTracingConfigured,
    logLevel,
    tracingConfig,
  } = await import("@/lib/runtime-config/observability");

  assert.equal(logLevel(), "error");
  process.env.LOG_LEVEL = "verbose";
  assert.equal(logLevel(), "info");

  assert.equal(appVersion(), "0.0.0");
  process.env.npm_package_version = "1.2.3";
  assert.equal(appVersion(), "1.2.3");
  process.env.APP_VERSION = "2.0.0";
  assert.equal(appVersion(), "2.0.0");

  assert.equal(tracingConfig(), null);
  assert.equal(isTracingConfigured(), false);

  process.env.TRACING_ENABLED = "on";
  process.env.OTEL_SERVICE_NAME = "reader-api";
  let cfg = tracingConfig();
  assert.deepEqual(cfg && { exporter: cfg.exporter, endpoint: cfg.endpoint, serviceName: cfg.serviceName }, {
    exporter: "console",
    endpoint: null,
    serviceName: "reader-api",
  });

  process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT = "http://otel.example/v1/traces";
  cfg = tracingConfig();
  assert.equal(cfg?.exporter, "otlp");
  assert.equal(cfg?.endpoint, "http://otel.example/v1/traces");
  assert.equal(isTracingConfigured(), true);

  delete process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "http://otel.example";
  assert.equal(tracingConfig()?.endpoint, "http://otel.example");

  process.env.ERROR_REPORTING_PROVIDER = "SENTRY";
  assert.equal(errorReportingProvider(), "sentry");
  assert.equal(errorAlertThreshold(), 10);
  process.env.ERROR_ALERT_THRESHOLD = "3";
  assert.equal(errorAlertThreshold(), 3);
  process.env.ERROR_ALERT_THRESHOLD = "0";
  assert.equal(errorAlertThreshold(), 10);
});

test("dictionary config normalizes provider, language, and directory", async () => {
  const {
    dictionaryProviderMode,
    localDictionaryDir,
    localDictionaryLanguage,
  } = await import("@/lib/runtime-config/dictionary");

  assert.equal(dictionaryProviderMode(), "local");
  process.env.DICTIONARY_PROVIDER = "free";
  assert.equal(dictionaryProviderMode(), "free");
  process.env.DICTIONARY_PROVIDER = "hybrid";
  assert.equal(dictionaryProviderMode(), "hybrid");
  process.env.DICTIONARY_PROVIDER = "unknown-provider";
  assert.equal(dictionaryProviderMode(), "local");

  assert.equal(localDictionaryLanguage(), "en");
  process.env.LOCAL_DICTIONARY_LANGUAGE = "zh";
  assert.equal(localDictionaryLanguage(), "cn");
  process.env.LOCAL_DICTIONARY_LANGUAGE = "cn";
  assert.equal(localDictionaryLanguage(), "cn");
  process.env.LOCAL_DICTIONARY_LANGUAGE = "de";
  assert.equal(localDictionaryLanguage(), "en");

  process.env.LOCAL_DICTIONARY_DIR = "fixtures/dict";
  assert.equal(localDictionaryDir(), path.resolve(process.cwd(), "fixtures/dict"));
});

test("runtime config leaf modules clamp environment values", async () => {
  const analytics = await import("@/lib/runtime-config/analytics");
  const rateLimit = await import("@/lib/runtime-config/rate-limit");
  const security = await import("@/lib/runtime-config/security");
  const speech = await import("@/lib/runtime-config/speech");
  const storage = await import("@/lib/runtime-config/storage");

  assert.equal(analytics.analyticsEnabled(), false);
  process.env.ANALYTICS_ENABLED = "true";
  assert.equal(analytics.analyticsEnabled(), true);
  process.env.ANALYTICS_ENABLED = "0";
  assert.equal(analytics.analyticsEnabled(), false);
  process.env.ANALYTICS_RETENTION_DAYS = "45";
  assert.equal(analytics.analyticsRetentionDays(), 45);
  process.env.ANALYTICS_RETENTION_DAYS = "-1";
  assert.equal(analytics.analyticsRetentionDays(), 400);

  process.env.RATE_LIMIT_AI_REQUESTS = "5";
  process.env.RATE_LIMIT_LOOKUP_REQUESTS = "6";
  process.env.RATE_LIMIT_PUBLIC_REQUESTS = "7";
  process.env.RATE_LIMIT_IMPORT_REQUESTS = "8";
  process.env.RATE_LIMIT_ADMIN_JOB_REQUESTS = "9";
  process.env.RATE_LIMIT_AUTH_REQUESTS = "10";
  process.env.RATE_LIMIT_WINDOW_MS = "11000";
  assert.equal(rateLimit.rateLimitAiRequests(), 5);
  assert.equal(rateLimit.rateLimitLookupRequests(), 6);
  assert.equal(rateLimit.rateLimitPublicRequests(), 7);
  assert.equal(rateLimit.rateLimitImportRequests(), 8);
  assert.equal(rateLimit.rateLimitAdminJobRequests(), 9);
  assert.equal(rateLimit.rateLimitAuthRequests(), 10);
  assert.equal(rateLimit.rateLimitWindowMs(), 11000);
  process.env.RATE_LIMIT_STORE = "database";
  assert.equal(rateLimit.rateLimitStoreMode(), "database");
  process.env.RATE_LIMIT_STORE = "memory";
  assert.equal(rateLimit.rateLimitStoreMode(), "memory");
  process.env.RATE_LIMIT_STORE = "auto";
  assert.equal(rateLimit.rateLimitStoreMode(), "auto");
  process.env.RATE_LIMIT_STORE = "elsewhere";
  assert.equal(rateLimit.rateLimitStoreMode(), "memory");
  mutableEnv.NODE_ENV = "production";
  assert.equal(rateLimit.rateLimitStoreMode(), "auto");

  assert.equal(speech.speechTimeoutMs(), 30_000);
  process.env.SPEECH_TIMEOUT_MS = "250";
  assert.equal(speech.speechTimeoutMs(), 250);
  process.env.SPEECH_TIMEOUT_MS = "-1";
  assert.equal(speech.speechTimeoutMs(), 30_000);
  assert.equal(speech.speechConfig.get(), null);
  process.env.AZURE_SPEECH_KEY = "test-key";
  process.env.AZURE_SPEECH_REGION = "eastus";
  assert.equal(speech.speechConfig.get()?.voice, speech.DEFAULT_SPEECH_VOICE);
  process.env.AZURE_SPEECH_VOICE = "en-US-TestNeural";
  process.env.AZURE_SPEECH_OUTPUT_FORMAT = "audio-16khz-32kbitrate-mono-mp3";
  assert.deepEqual(speech.speechConfig.get(), {
    key: "test-key",
    region: "eastus",
    voice: "en-US-TestNeural",
    format: "audio-16khz-32kbitrate-mono-mp3",
  });

  assert.deepEqual(security.trustedProxyConfig(), { hops: null, list: [], header: null });
  process.env.TRUSTED_PROXY_HOPS = "2";
  process.env.TRUSTED_PROXY_LIST = " 10.0.0.1, ,10.0.0.2 ";
  process.env.TRUSTED_PROXY_HEADER = "X-Forwarded-For";
  assert.deepEqual(security.trustedProxyConfig(), {
    hops: 2,
    list: ["10.0.0.1", "10.0.0.2"],
    header: "x-forwarded-for",
  });
  assert.equal(security.isTrustedProxyConfigured(), true);
  process.env.TRUSTED_PROXY_HOPS = "-1";
  delete process.env.TRUSTED_PROXY_LIST;
  delete process.env.TRUSTED_PROXY_HEADER;
  assert.equal(security.trustedProxyConfig().hops, null);

  process.env.CSRF_ALLOWED_ORIGINS = "https://app.example/path, localhost:3000, not a url ???";
  process.env.NEXTAUTH_URL = "http://localhost:3000";
  process.env.APP_URL = "https://app.example";
  process.env.NEXT_PUBLIC_APP_URL = "https://public.example";
  assert.deepEqual(security.csrfAllowedOrigins().sort(), [
    "http://localhost:3000",
    "https://app.example",
    "https://public.example",
    "null",
  ]);
  assert.equal(security.csrfEnforceSameOrigin(), true);
  process.env.CSRF_ENFORCE = "off";
  assert.equal(security.csrfEnforceSameOrigin(), false);
  process.env.SECURITY_EVENT_ALERT_THRESHOLD = "4";
  process.env.SECURITY_EVENT_WINDOW_MS = "5000";
  process.env.SECURITY_EVENT_BUFFER_SIZE = "5001";
  process.env.AUDIT_LOG_RETENTION_DAYS = "91";
  assert.equal(security.securityEventAlertThreshold(), 4);
  assert.equal(security.securityEventWindowMs(), 5000);
  assert.equal(security.securityEventBufferSize(), 2000);
  assert.equal(security.auditLogRetentionDays(), 91);

  assert.equal(storage.mediaStorageKind(), "local");
  process.env.MEDIA_STORAGE = "filesystem";
  assert.equal(storage.mediaStorageKind(), "local");
  process.env.MEDIA_STORAGE = "local";
  assert.equal(storage.mediaStorageKind(), "local");
  process.env.MEDIA_STORAGE = "azure";
  assert.equal(storage.mediaStorageKind(), "azure");
  process.env.MEDIA_STORAGE = "bogus";
  assert.equal(storage.mediaStorageKind(), "local");
  process.env.MEDIA_STORAGE_DIR = "media-fixtures";
  assert.equal(storage.mediaStorageDir(), path.resolve("media-fixtures"));
  assert.equal(storage.azureStorageConfig(), null);
  process.env.AZURE_STORAGE_CONTAINER = "audio";
  process.env.AZURE_STORAGE_CONNECTION_STRING = "UseDevelopmentStorage=true";
  assert.deepEqual(storage.azureStorageConfig(), {
    connectionString: "UseDevelopmentStorage=true",
    container: "audio",
  });
  delete process.env.AZURE_STORAGE_CONNECTION_STRING;
  process.env.AZURE_STORAGE_ACCOUNT = "acct";
  process.env.AZURE_STORAGE_KEY = "test-storage-key";
  assert.deepEqual(storage.azureStorageConfig(), {
    accountName: "acct",
    accountKey: "test-storage-key",
    container: "audio",
  });
});

test("validateRuntimeConfig reports malformed required, optional, and tuning settings", async () => {
  const { validateRuntimeConfig } = await import("@/lib/runtime-config/runtime");

  setRequiredRuntimeEnv();
  let report = validateRuntimeConfig();
  assert.equal(report.ready, true);
  assert.equal(report.status, "ready");

  process.env.DATABASE_URL = "https://example.invalid/db";
  report = validateRuntimeConfig();
  assert.equal(report.ready, false);
  assert.equal(report.required.database.status, "malformed");
  assert.ok(report.errors.some((item) => item.code === "invalid_database_url"));

  setRequiredRuntimeEnv();
  process.env.NEXTAUTH_SECRET = "change-me";
  report = validateRuntimeConfig();
  assert.equal(report.required.auth.status, "malformed");
  assert.ok(report.errors.some((item) => item.code === "placeholder_secret"));

  setRequiredRuntimeEnv();
  process.env.AZURE_SPEECH_KEY = "test-key";
  process.env.AZURE_SPEECH_REGION = "bad region";
  process.env.AZURE_SPEECH_OUTPUT_FORMAT = "audio/wav";
  process.env.AI_MAX_RETRIES = "-1";
  process.env.AI_REQUEST_TIMEOUT_MS = "0";
  process.env.LOG_LEVEL = "chatty";
  report = validateRuntimeConfig();
  assert.equal(report.optional.speech.status, "degraded");
  assert.equal(report.tuning.status, "degraded");
  assert.ok(report.warnings.some((item) => item.code === "unsupported_speech_format"));
  assert.ok(report.warnings.some((item) => item.code === "invalid_nonnegative_integer"));
  assert.ok(report.warnings.some((item) => item.code === "invalid_log_level"));

  process.env.MEDIA_STORAGE = "azure";
  delete process.env.AZURE_STORAGE_CONNECTION_STRING;
  delete process.env.AZURE_STORAGE_ACCOUNT;
  delete process.env.AZURE_STORAGE_KEY;
  report = validateRuntimeConfig();
  assert.equal(report.optional.storage.status, "degraded");
  assert.ok(report.optional.storage.missing[0].includes("AZURE_STORAGE_CONNECTION_STRING"));

  process.env.MEDIA_STORAGE = "unknown";
  report = validateRuntimeConfig();
  assert.equal(report.optional.storage.status, "degraded");
  assert.ok(report.warnings.some((item) => item.code === "unknown_storage_kind"));

  setRequiredRuntimeEnv();
  process.env.DATABASE_URL = "not a database url";
  report = validateRuntimeConfig();
  assert.ok(report.errors.some((item) => item.code === "invalid_database_url"));

  setRequiredRuntimeEnv();
  process.env.AZURE_OPENAI_ENDPOINT = "ftp://azure.example";
  process.env.AZURE_OPENAI_API_KEY = "test-key";
  process.env.AZURE_OPENAI_DEPLOYMENT = "deployment";
  process.env.AZURE_OPENAI_API_VERSION = "bad-version";
  process.env.VAPID_PUBLIC_KEY = "public";
  process.env.VAPID_PRIVATE_KEY = "private";
  process.env.VAPID_SUBJECT = "not-a-subject";
  report = validateRuntimeConfig();
  assert.ok(report.warnings.some((item) => item.code === "invalid_url_protocol"));
  assert.ok(report.warnings.some((item) => item.code === "invalid_api_version"));
  assert.ok(report.warnings.some((item) => item.code === "invalid_vapid_subject"));

  setRequiredRuntimeEnv();
  process.env.MEDIA_STORAGE = "filesystem";
  report = validateRuntimeConfig();
  assert.equal(report.optional.storage.status, "configured");

  process.env.MEDIA_STORAGE = "azure";
  process.env.AZURE_STORAGE_CONNECTION_STRING = "UseDevelopmentStorage=true";
  report = validateRuntimeConfig();
  assert.equal(report.optional.storage.status, "configured");
});
