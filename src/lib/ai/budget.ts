/**
 * AI budgets, quotas & per-feature usage controls (RW-022).
 *
 * Caps AI provider usage so a bug, abusive user, or runaway worker can't blow
 * the AI budget. Two enforcement surfaces:
 *
 *   - INTERACTIVE (user-facing API routes): enforce per-user + per-feature +
 *     global-interactive caps. {@link assertAiQuota} throws an {@link ApiError}
 *     (429) when exceeded so the api-handler returns a clean, user-friendly 429.
 *   - BACKGROUND (worker / seed / processor enrichment): enforce per-feature +
 *     global-background caps. {@link checkAiBudget} is NON-throwing so the AI
 *     call is skipped (degrading to the helper's graceful fallback) instead of
 *     crashing the worker.
 *
 * Storage / accounting:
 *   - ENFORCEMENT uses cheap fixed-window COUNTERS via the shared (DB-backed)
 *     fixed-window counter module so limits hold across
 *     app instances, with the same in-memory FALLBACK + circuit breaker the
 *     rate limiter uses (graceful degradation for dev / tests / DB outage).
 *   - REPORTING ({@link getAiBudgetStatus}) reads real usage from the AI
 *     invocation LEDGER ({@link summarizeAiUsage}) for the current window, which
 *     reflects actual provider calls + estimated cost.
 *
 * The "kind" (interactive vs background) flows either explicitly (an option on
 * {@link "@/lib/ai".chatCompleteWithMeta}) or ambiently via an
 * {@link AsyncLocalStorage} context set by the processor
 * ({@link runWithAiContext}) — so background enrichment is covered with no
 * per-helper plumbing.
 *
 * Quotas are DISABLED (unlimited) when their env knobs are unset, so dev/CI run
 * with no budget configured.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { ApiError } from "@/lib/errors/api-error";
import { createLogger, getRequestContext } from "@/lib/observability/logger";
import {
  aiQuotaConfig,
  configuredAiQuotaFeatures,
  type AiQuotaConfig,
} from "@/lib/runtime-config/ai";
import {
  consumeFixedWindow,
  fixedWindowStart,
} from "@/lib/security/fixed-window-counter";
import { summarizeAiUsage } from "@/lib/ai/usage-summary";

const log = createLogger("ai-budget");
const UNKNOWN_FEATURE = "unknown";
const HOUR_MS = 3_600_000;

export type AiBudgetKind = "interactive" | "background";

/** Which configured limit blocked a call (for logs / 429 messages). */
export type AiBudgetScope = "user" | "feature" | "global" | "global-background";

export type AiBudgetCheckInput = {
  /** Short feature label (e.g. "translation", "quiz"). */
  feature: string;
  /** Acting user id; resolved from the ambient context when omitted. */
  userId?: string | null;
  /** Interactive (default) vs background; resolved from context when omitted. */
  kind?: AiBudgetKind;
};

export type AiBudgetDecision = {
  allowed: boolean;
  feature: string;
  kind: AiBudgetKind;
  userId: string | null;
  /** Set only when blocked: which limit tripped + its value and the new count. */
  scope?: AiBudgetScope;
  limit?: number;
  used?: number;
};

// ---------------------------------------------------------------------------
// Ambient AI execution context (so background calls inherit kind/userId)
// ---------------------------------------------------------------------------

type AiContext = { kind?: AiBudgetKind; userId?: string | null };

const aiContextStore = new AsyncLocalStorage<AiContext>();

/**
 * Runs `fn` with an ambient AI context. Used by the processor to mark all
 * AI calls within an enrichment run as `kind: "background"` without threading
 * an option through every cache-first helper.
 */
export function runWithAiContext<T>(ctx: AiContext, fn: () => T): T {
  return aiContextStore.run(ctx, fn);
}

/** The current ambient AI context, or undefined when not inside one. */
export function getAiContext(): AiContext | undefined {
  return aiContextStore.getStore();
}

// ---------------------------------------------------------------------------
// Windowed counters
// ---------------------------------------------------------------------------

const BUCKET_PREFIX = "aibudget:";

/**
 * Atomically increment a budget counter for the current window and return the
 * new count. Tries the shared DB store first (consistent across instances),
 * falling back to the in-memory counter when that store is unavailable.
 */
async function incrementBudget(key: string, windowMs: number, nowMs: number): Promise<number> {
  return consumeFixedWindow({
    key: `${BUCKET_PREFIX}${key}`,
    windowMs,
    nowMs,
    fallbackWindowAnchor: "epoch",
  });
}

// ---------------------------------------------------------------------------
// Dimensions
// ---------------------------------------------------------------------------

type Dim = { scope: AiBudgetScope; key: string; limit: number };

function pushLimitedDim(
  dims: Dim[],
  scope: AiBudgetScope,
  key: string,
  limit: number | null,
): void {
  if (limit !== null) {
    dims.push({ scope, key, limit });
  }
}

/**
 * The ordered list of quota dimensions to enforce for a call. Ordered by
 * priority (most specific first) so the first tripped dimension stops further
 * increments — a blocked call doesn't consume lower-priority budgets.
 *
 * Interactive: user → feature → global-interactive.
 * Background:  feature → global-background.
 *
 * The per-feature counter is SHARED across kinds (a total per-feature cap).
 */
function buildDims(
  cfg: AiQuotaConfig,
  feature: string,
  userId: string | null,
  kind: AiBudgetKind,
): Dim[] {
  const dims: Dim[] = [];
  const featureLimit = cfg.featureDaily(feature);
  if (kind === "interactive") {
    if (userId && cfg.userDaily !== null) {
      dims.push({ scope: "user", key: `user:${userId}`, limit: cfg.userDaily });
    }
    pushLimitedDim(dims, "feature", `feature:${feature}`, featureLimit);
    pushLimitedDim(dims, "global", "global:interactive", cfg.globalDaily);
  } else {
    pushLimitedDim(dims, "feature", `feature:${feature}`, featureLimit);
    pushLimitedDim(dims, "global-background", "global:background", cfg.backgroundDaily);
  }
  return dims;
}

function resolveKind(input: AiBudgetCheckInput): AiBudgetKind {
  return input.kind ?? getAiContext()?.kind ?? "interactive";
}

function resolveUserId(input: AiBudgetCheckInput): string | null {
  return input.userId ?? getAiContext()?.userId ?? getRequestContext()?.userId ?? null;
}

function allowedDecision(
  feature: string,
  kind: AiBudgetKind,
  userId: string | null,
): AiBudgetDecision {
  return { allowed: true, feature, kind, userId };
}

function blockedDecision(
  feature: string,
  kind: AiBudgetKind,
  userId: string | null,
  dim: Dim,
  used: number,
): AiBudgetDecision {
  return {
    allowed: false,
    feature,
    kind,
    userId,
    scope: dim.scope,
    limit: dim.limit,
    used,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Non-throwing budget check used by background/worker paths. Increments the
 * applicable windowed counters and returns whether the call is allowed. When a
 * limit is exceeded, `allowed` is false and the offending `scope`/`limit`/`used`
 * are returned so the caller can log + skip gracefully.
 *
 * When no quotas are configured for the resolved kind, this is a cheap no-op
 * (no counter increments) and always returns `allowed: true`.
 */
export async function checkAiBudget(
  input: AiBudgetCheckInput,
  now: number = Date.now(),
): Promise<AiBudgetDecision> {
  const cfg = aiQuotaConfig();
  const kind = resolveKind(input);
  const userId = resolveUserId(input);
  const feature = input.feature || UNKNOWN_FEATURE;

  const dims = buildDims(cfg, feature, userId, kind);
  if (dims.length === 0) {
    return allowedDecision(feature, kind, userId);
  }

  for (const dim of dims) {
    const count = await incrementBudget(dim.key, cfg.windowMs, now);
    if (count > dim.limit) {
      return blockedDecision(feature, kind, userId, dim, count);
    }
  }
  return allowedDecision(feature, kind, userId);
}

/** Build a user-friendly 429 message for a blocked interactive call. */
function quotaMessage(decision: AiBudgetDecision, windowMs: number): string {
  const hours = Math.max(1, Math.round(windowMs / HOUR_MS));
  const subject =
    decision.scope === "user"
      ? "your"
      : decision.scope === "feature"
        ? `this feature's`
        : "the";
  return (
    `AI usage limit reached for ${subject} ${decision.scope === "feature" ? "" : "AI "}budget ` +
    `(${decision.limit} per ${hours}h). Please try again later.`
  );
}

/**
 * Throwing budget check for INTERACTIVE request paths. Throws
 * `ApiError(429)` (surfaced as a clean 429 by the api-handler) when a per-user,
 * per-feature, or global-interactive quota is exceeded. No-op when quotas are
 * unconfigured.
 */
export async function assertAiQuota(
  input: AiBudgetCheckInput,
  now: number = Date.now(),
): Promise<void> {
  const decision = await checkAiBudget({ ...input, kind: input.kind ?? "interactive" }, now);
  if (!decision.allowed) {
    log.warn("ai_budget.blocked", {
      feature: decision.feature,
      kind: decision.kind,
      scope: decision.scope,
      limit: decision.limit,
      used: decision.used,
      userId: decision.userId,
    });
    throw new ApiError(429, quotaMessage(decision, aiQuotaConfig().windowMs));
  }
}

// ---------------------------------------------------------------------------
// Admin reporting
// ---------------------------------------------------------------------------

export type AiBudgetLimitStatus = {
  limit: number | null;
  used: number;
  remaining: number | null;
};

export type AiBudgetFeatureStatus = AiBudgetLimitStatus & { feature: string };

export type AiBudgetStatus = {
  /** Window length (ms) over which usage is counted. */
  windowMs: number;
  /** ISO timestamp of the current fixed window's start. */
  windowStart: string;
  /** Total AI provider calls recorded in the ledger this window. */
  totalUsed: number;
  /** Estimated USD cost of this window's AI usage (from the ledger). */
  estimatedCostUsd: number;
  /** Configured caps (null = unlimited). */
  limits: {
    userDaily: number | null;
    globalDaily: number | null;
    backgroundDaily: number | null;
    featureDefaultDaily: number | null;
  };
  /** Global usage vs the interactive/background caps. */
  global: {
    interactive: AiBudgetLimitStatus;
    background: AiBudgetLimitStatus;
  };
  /** Per-feature usage vs its configured cap. */
  features: AiBudgetFeatureStatus[];
};

function limitStatus(limit: number | null, used: number): AiBudgetLimitStatus {
  return { limit, used, remaining: limit === null ? null : Math.max(0, limit - used) };
}

/**
 * Snapshot of AI usage vs configured limits for the CURRENT window, for admin
 * reporting. Usage is read from the ledger (real provider calls + cost); limits
 * come from env config. The global interactive/background limits both compare
 * against total usage since the ledger does not split usage by kind.
 */
export async function getAiBudgetStatus(now: number = Date.now()): Promise<AiBudgetStatus> {
  const cfg = aiQuotaConfig();
  const windowStartMs = fixedWindowStart(now, cfg.windowMs);
  const since = new Date(windowStartMs);
  const summary = await summarizeAiUsage({ since });

  const featureUsage = new Map(summary.byFeature.map((g) => [g.key, g.count]));
  const featureNames = new Set<string>([
    ...featureUsage.keys(),
    ...configuredAiQuotaFeatures(),
  ]);
  const features: AiBudgetFeatureStatus[] = [...featureNames]
    .sort()
    .map((feature) => {
      const used = featureUsage.get(feature) ?? 0;
      return { feature, ...limitStatus(cfg.featureDaily(feature), used) };
    });

  const total = summary.total.count;
  return {
    windowMs: cfg.windowMs,
    windowStart: since.toISOString(),
    totalUsed: total,
    estimatedCostUsd: summary.total.estimatedCostUsd,
    limits: {
      userDaily: cfg.userDaily,
      globalDaily: cfg.globalDaily,
      backgroundDaily: cfg.backgroundDaily,
      featureDefaultDaily: cfg.featureDefaultDaily,
    },
    global: {
      interactive: limitStatus(cfg.globalDaily, total),
      background: limitStatus(cfg.backgroundDaily, total),
    },
    features,
  };
}
