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
 * IMPORTANT: env names, defaults and trimming MUST stay identical to the
 * historical inline reads — this module is a pure centralization, not a
 * behavior change. Never import this from a Client Component or the service
 * worker (it reads process.env at runtime).
 */

/** A configured-or-null view over a multi-variable feature's environment. */
export type FeatureConfig<T> = {
  /** The typed config object, or `null` when any required var is missing. */
  get(): T | null;
  /** Whether every required env var for this feature is present. */
  isConfigured(): boolean;
};

/** Wraps a `read` function into a {@link FeatureConfig}. */
function defineFeatureConfig<T>(read: () => T | null): FeatureConfig<T> {
  return {
    get: read,
    isConfigured: () => read() !== null,
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
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT?.replace(/\/+$/, "");
  const apiKey = process.env.AZURE_OPENAI_API_KEY;
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT;
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION;
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
    const key = process.env.AZURE_SPEECH_KEY;
    const region = process.env.AZURE_SPEECH_REGION;
    if (!key || !region) {
      return null;
    }
    return {
      key,
      region,
      voice: process.env.AZURE_SPEECH_VOICE || DEFAULT_SPEECH_VOICE,
      format:
        process.env.AZURE_SPEECH_OUTPUT_FORMAT || DEFAULT_SPEECH_OUTPUT_FORMAT,
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
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  const subject = process.env.VAPID_SUBJECT?.trim();
  if (!publicKey || !privateKey || !subject) {
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
const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;

/** Max requests per key per window for the "ai" scope (default 20). */
export function rateLimitAiRequests(): number {
  const v = parseInt(process.env.RATE_LIMIT_AI_REQUESTS ?? "", 10);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_RATE_LIMIT_AI;
}

/** Max requests per key per window for the "lookup" scope (default 60). */
export function rateLimitLookupRequests(): number {
  const v = parseInt(process.env.RATE_LIMIT_LOOKUP_REQUESTS ?? "", 10);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_RATE_LIMIT_LOOKUP;
}

/** Max requests per key per window for the "public" scope (default 30). */
export function rateLimitPublicRequests(): number {
  const v = parseInt(process.env.RATE_LIMIT_PUBLIC_REQUESTS ?? "", 10);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_RATE_LIMIT_PUBLIC;
}

/** Rate-limit window length in ms (RATE_LIMIT_WINDOW_MS, default 60000). */
export function rateLimitWindowMs(): number {
  const v = parseInt(process.env.RATE_LIMIT_WINDOW_MS ?? "", 10);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_RATE_LIMIT_WINDOW_MS;
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
