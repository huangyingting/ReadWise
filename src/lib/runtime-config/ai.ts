/**
 * Azure OpenAI config, cost, ledger, and quota (server-only).
 *
 * IMPORTANT: never import from a Client Component.
 */
import {
  defineFeatureConfig,
  envValue,
  positiveIntEnv,
  type FeatureConfig,
} from "./env";

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
const DEFAULT_AI_MAX_CONTEXT_TOKENS = 128_000;
const DEFAULT_AI_MAX_OUTPUT_TOKENS = 4096;

function intEnv(name: string, fallback: number, isValid: (value: number) => boolean): number {
  const value = parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(value) && isValid(value) ? value : fallback;
}

/** Per-request AI timeout in ms (AI_REQUEST_TIMEOUT_MS, default 30000). */
export function aiTimeoutMs(): number {
  return intEnv("AI_REQUEST_TIMEOUT_MS", DEFAULT_AI_TIMEOUT_MS, (value) => value > 0);
}

/** Max AI retry attempts (AI_MAX_RETRIES, default 2). */
export function aiMaxRetries(): number {
  return intEnv("AI_MAX_RETRIES", DEFAULT_AI_MAX_RETRIES, (value) => value >= 0);
}

/**
 * Model context window in tokens (AZURE_OPENAI_MAX_CONTEXT_TOKENS, default 128000).
 */
export function aiMaxContextTokens(): number {
  return intEnv(
    "AZURE_OPENAI_MAX_CONTEXT_TOKENS",
    DEFAULT_AI_MAX_CONTEXT_TOKENS,
    (value) => value > 0,
  );
}

/** Default completion-token budget when a caller omits one (default 4096). */
export function aiDefaultMaxOutputTokens(): number {
  return intEnv("AI_MAX_OUTPUT_TOKENS", DEFAULT_AI_MAX_OUTPUT_TOKENS, (value) => value > 0);
}

// ---------------------------------------------------------------------------
// AI invocation ledger + cost estimation (RW-019)
// ---------------------------------------------------------------------------

export type AiCostRate = { prompt: number; completion: number };
export type AiCostConfig = { default: AiCostRate; byModel: Record<string, AiCostRate> };

const DEFAULT_AI_COST_PROMPT_PER_1K = 0.00015;
const DEFAULT_AI_COST_COMPLETION_PER_1K = 0.0006;

function nonNegativeFloat(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
}

function nonNegativeFloatEnv(name: string, fallback: number): number {
  return nonNegativeFloat(process.env[name]) ?? fallback;
}

function parseCostRateMap(raw: string | undefined): Record<string, AiCostRate> {
  if (!raw || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, AiCostRate> = {};
    for (const [model, value] of Object.entries(parsed)) {
      if (value && typeof value === "object") {
        const rate = value as { prompt?: unknown; completion?: unknown };
        const prompt = nonNegativeFloat(rate.prompt);
        const completion = nonNegativeFloat(rate.completion);
        if (prompt !== null && completion !== null) {
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
 * Defaults OFF under NODE_ENV=test and ON otherwise. Set AI_LEDGER_ENABLED=0 to disable.
 */
export function aiLedgerEnabled(): boolean {
  const raw = (process.env.AI_LEDGER_ENABLED ?? "").trim().toLowerCase();
  if (raw === "1" || raw === "true") return true;
  if (raw === "0" || raw === "false") return false;
  return process.env.NODE_ENV !== "test";
}

/**
 * Retention window (in days) for pruneOldAiInvocations. Defaults to 365 days.
 * Set via AI_LEDGER_RETENTION_DAYS.
 */
export function aiLedgerRetentionDays(): number {
  return positiveIntEnv("AI_LEDGER_RETENTION_DAYS", 365);
}

// ---------------------------------------------------------------------------
// AI budgets / quotas (RW-022)
// ---------------------------------------------------------------------------

export type AiQuotaConfig = {
  windowMs: number;
  userDaily: number | null;
  globalDaily: number | null;
  backgroundDaily: number | null;
  featureDefaultDaily: number | null;
  featureDaily(feature: string): number | null;
};

const DEFAULT_AI_QUOTA_WINDOW_MS = 86_400_000; // 24h

function optionalPositiveIntEnv(name: string): number | null {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return null;
  const value = parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** Normalize a feature label to the env-var token used for its override. */
export function aiQuotaFeatureEnvName(feature: string): string {
  const token = feature
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `AI_QUOTA_FEATURE_${token}_DAILY`;
}

/** Resolved AI usage quotas (env-driven; null limits mean unlimited). */
export function aiQuotaConfig(): AiQuotaConfig {
  const featureDefaultDaily = optionalPositiveIntEnv("AI_QUOTA_FEATURE_DEFAULT_DAILY");
  return {
    windowMs: positiveIntEnv("AI_QUOTA_WINDOW_MS", DEFAULT_AI_QUOTA_WINDOW_MS),
    userDaily: optionalPositiveIntEnv("AI_QUOTA_USER_DAILY"),
    globalDaily: optionalPositiveIntEnv("AI_QUOTA_GLOBAL_DAILY"),
    backgroundDaily: optionalPositiveIntEnv("AI_QUOTA_BACKGROUND_DAILY"),
    featureDefaultDaily,
    featureDaily(feature: string): number | null {
      return optionalPositiveIntEnv(aiQuotaFeatureEnvName(feature)) ?? featureDefaultDaily;
    },
  };
}

/**
 * Best-effort list of feature labels that have an explicit per-feature override
 * configured via AI_QUOTA_FEATURE_<FEATURE>_DAILY.
 */
export function configuredAiQuotaFeatures(): string[] {
  const out: string[] = [];
  for (const key of Object.keys(process.env)) {
    const match = /^AI_QUOTA_FEATURE_(.+)_DAILY$/.exec(key);
    if (!match || match[1] === "DEFAULT") continue;
    if (optionalPositiveIntEnv(key) === null) continue;
    out.push(match[1].toLowerCase().replace(/_/g, "-"));
  }
  return out;
}

// ---------------------------------------------------------------------------
// AI provider selection
// ---------------------------------------------------------------------------

/** Active AI provider selector key (AI_PROVIDER, default "azure"). */
export function aiProvider(): string {
  const raw = process.env.AI_PROVIDER?.trim().toLowerCase();
  return raw && raw.length > 0 ? raw : "azure";
}

// ---------------------------------------------------------------------------
// Remote moderation
// ---------------------------------------------------------------------------

/**
 * Whether an optional remote moderation provider is enabled (AI_MODERATION_ENABLED).
 * Off by default; the local heuristic always runs regardless.
 */
export function isRemoteModerationEnabled(): boolean {
  const v = process.env.AI_MODERATION_ENABLED?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "on";
}
