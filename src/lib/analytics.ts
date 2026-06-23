/**
 * Product analytics event model (Epic RW-E010 — RW-051).
 *
 * A general-purpose, append-only stream of product analytics events backed by
 * the `AnalyticsEvent` table. It COMPLEMENTS (never replaces) the domain and
 * activity tables (ReadingProgress, SavedWord, QuizAttempt, …) and powers
 * funnel / activation / retention / feature-usage analysis (RW-052) without
 * coupling those dashboards to a dozen different domain tables.
 *
 * Design principles (matching the AiInvocation/AuditLog ledger conventions):
 *   - METADATA ONLY. The `properties` payload is for small, non-sensitive
 *     metadata (counts, enums, ids). It MUST NEVER contain article text,
 *     selected text, prompts, dictionary definitions, or PII. {@link recordEvent}
 *     sanitizes the payload (drops sensitive keys, truncates long strings, caps
 *     key count) and stamps the schema version so stored data is self-describing.
 *   - BEST-EFFORT, NON-BLOCKING. {@link recordEvent} never throws — an analytics
 *     write must never break the user action that emitted it. It logs a warning
 *     and moves on. No-op when {@link analyticsEnabled} is false.
 *   - NON-FK REFERENCES. `userId`/`articleId` are plain string identifiers (NOT
 *     foreign keys, like AuditLog/AiInvocation/Job) so an event survives user or
 *     article deletion and never cascades. Privacy is enforced by the documented
 *     retention window ({@link pruneOldEvents}) and an explicit per-user purge
 *     ({@link deleteEventsForUser}).
 *   - REQUEST-AWARE. `userId` defaults from the logger's request-scoped context
 *     so call sites don't have to thread it.
 *
 * See `docs/analytics.md` for the versioned event schema + retention rules.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createLogger, getRequestContext } from "@/lib/logger";
import { analyticsEnabled, analyticsRetentionDays } from "@/lib/config";

const logger = createLogger("analytics");

/**
 * The versioned set of product-critical event types (RW-051). The string value
 * is the persisted `type`. Bump {@link ANALYTICS_SCHEMA_VERSION} whenever the
 * MEANING of an event or the shape of its `properties` changes.
 */
export const ANALYTICS_EVENT_TYPES = {
  onboardingStart: "onboarding_start",
  onboardingComplete: "onboarding_complete",
  articleView: "article_view",
  progressComplete: "progress_complete",
  lookup: "lookup",
  saveWord: "save_word",
  quizStart: "quiz_start",
  quizComplete: "quiz_complete",
  translationUse: "translation_use",
  tutorUse: "tutor_use",
  offlineSave: "offline_save",
  import: "import",
  studyReview: "study_review",
} as const;

/** Union of all canonical event type string literals. */
export type AnalyticsEventType =
  (typeof ANALYTICS_EVENT_TYPES)[keyof typeof ANALYTICS_EVENT_TYPES];

/** Every event type value, useful for documentation/tests/validation. */
export const ALL_ANALYTICS_EVENT_TYPES: readonly AnalyticsEventType[] =
  Object.values(ANALYTICS_EVENT_TYPES);

/**
 * Schema version for the analytics event stream. Stamped into every event's
 * `properties._v` so downstream consumers can interpret older rows correctly.
 * Bump on any breaking change to event semantics or property shapes.
 */
export const ANALYTICS_SCHEMA_VERSION = 1;

/** Metadata-only event input. No free-text content is ever accepted. */
export type AnalyticsEventInput = {
  type: AnalyticsEventType | string;
  /** Defaults from the request-scoped logger context when omitted. */
  userId?: string | null;
  anonymousId?: string | null;
  articleId?: string | null;
  sessionId?: string | null;
  /** Small, non-sensitive metadata only (sanitized before persistence). */
  properties?: Record<string, unknown> | null;
  /** When the event happened (defaults to now). */
  occurredAt?: Date;
};

/** Minimal prisma surface the writer needs (composable with $transaction). */
export type AnalyticsClient = Pick<Prisma.TransactionClient, "analyticsEvent">;

const MAX_TYPE_LEN = 80;
const MAX_ID_LEN = 200;
const MAX_PROPERTY_KEYS = 25;
const MAX_PROPERTY_STRING_LEN = 200;
const MAX_PROPERTY_ARRAY_ITEMS = 20;

/**
 * Keys that could carry sensitive free text / secrets are dropped from the
 * payload entirely. Analytics is metadata-only by contract; this is a backstop
 * so an accidental `{ text: article.body }` never lands in the stream.
 */
const SENSITIVE_PROPERTY_KEY_RE =
  /(authorization|content|cookie|credential|definition|email|example|explanation|key|password|pass|pwd|phrase|prompt|response|secret|selection|sentence|session|text|token|translation|url)/i;

function truncate(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max);
}

/** Coerce a single property value to a small, safe, serializable primitive. */
function sanitizePropertyValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") return truncate(value, MAX_PROPERTY_STRING_LEN);
  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_PROPERTY_ARRAY_ITEMS)
      .map((item) =>
        typeof item === "string"
          ? truncate(item, MAX_PROPERTY_STRING_LEN)
          : typeof item === "number" || typeof item === "boolean"
            ? item
            : null,
      );
  }
  // Objects/functions are not persisted as nested structures — analytics props
  // are intentionally flat. Drop anything we can't represent safely.
  return null;
}

/**
 * Sanitizes a caller-supplied property bag into a flat, metadata-only object:
 * drops sensitive keys, coerces values to safe primitives, caps the key count,
 * and stamps the schema version. NEVER stores nested objects or long text.
 */
export function sanitizeEventProperties(
  input: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const out: Record<string, unknown> = { _v: ANALYTICS_SCHEMA_VERSION };
  if (!input) return out;
  let count = 0;
  for (const [rawKey, value] of Object.entries(input)) {
    if (count >= MAX_PROPERTY_KEYS) break;
    if (rawKey === "_v") continue;
    if (SENSITIVE_PROPERTY_KEY_RE.test(rawKey)) continue;
    const key = truncate(rawKey, 60);
    out[key] = sanitizePropertyValue(value);
    count++;
  }
  return out;
}

function normalizeOptionalId(
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed ? truncate(trimmed, MAX_ID_LEN) : null;
}

/**
 * Persists one product analytics event (best-effort, metadata only). Never
 * throws — a write failure must never break the emitting user action. No-op
 * when {@link analyticsEnabled} is false (e.g. unit tests without opt-in).
 *
 * `userId` falls back to the request-scoped logger context so call sites inside
 * an authenticated request don't have to thread it.
 */
export async function recordEvent(
  input: AnalyticsEventInput,
  client: AnalyticsClient = prisma,
): Promise<void> {
  if (!analyticsEnabled()) return;
  try {
    const userId =
      normalizeOptionalId(input.userId) ??
      normalizeOptionalId(getRequestContext()?.userId) ??
      null;
    await client.analyticsEvent.create({
      data: {
        type: truncate(input.type || "unknown", MAX_TYPE_LEN),
        userId,
        anonymousId: normalizeOptionalId(input.anonymousId),
        articleId: normalizeOptionalId(input.articleId),
        sessionId: normalizeOptionalId(input.sessionId),
        properties: sanitizeEventProperties(input.properties) as Prisma.InputJsonValue,
        ...(input.occurredAt ? { occurredAt: input.occurredAt } : {}),
      },
    });
  } catch (err) {
    // Best-effort: an analytics write must never break a user action.
    logger.warn("analytics.write_failed", {
      type: input.type,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

type PruneClient = Pick<typeof prisma, "analyticsEvent">;

/**
 * Deletes analytics events older than the retention window (privacy/retention,
 * RW-051). `olderThanDays` defaults to {@link analyticsRetentionDays}. Returns
 * the number of rows removed. Intended to be run from a scheduled job/CLI.
 */
export async function pruneOldEvents(
  olderThanDays: number = analyticsRetentionDays(),
  client: PruneClient = prisma,
  now: Date = new Date(),
): Promise<number> {
  const days = Number.isFinite(olderThanDays) && olderThanDays > 0
    ? Math.floor(olderThanDays)
    : analyticsRetentionDays();
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const result = await client.analyticsEvent.deleteMany({
    where: { occurredAt: { lt: cutoff } },
  });
  return result.count;
}

/**
 * Deletes ALL analytics events for a user (privacy / GDPR erasure, RW-051).
 * Because `userId` is a plain string (not an FK), events do NOT cascade with
 * the user — call this explicitly when erasing a user's data. Returns the
 * number of rows removed.
 */
export async function deleteEventsForUser(
  userId: string,
  client: PruneClient = prisma,
): Promise<number> {
  if (!userId) return 0;
  const result = await client.analyticsEvent.deleteMany({ where: { userId } });
  return result.count;
}
