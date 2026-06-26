/**
 * Analytics event stream writer (REF-049).
 *
 * Provides best-effort, non-blocking event ingestion. `recordEvent` never
 * throws — an analytics write must never break the user action that emitted it.
 *
 * Design invariants (matching the AiInvocation/AuditLog ledger conventions):
 *   - METADATA ONLY. The `properties` payload is for small, non-sensitive
 *     metadata. It MUST NEVER contain article text, selected text, prompts,
 *     dictionary definitions, or PII. {@link sanitizeEventProperties} enforces
 *     this as a backstop before persistence.
 *   - BEST-EFFORT. Never throws; logs a warning and moves on on any failure.
 *     No-op when {@link analyticsEnabled} is false.
 *   - NON-FK REFERENCES. `userId`/`articleId` are plain string identifiers
 *     (NOT foreign keys) so an event survives user or article deletion and
 *     never cascades.
 *   - REQUEST-AWARE. `userId` defaults from the logger's request-scoped context
 *     so call sites don't have to thread it.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createLogger, getRequestContext } from "@/lib/observability/logger";
import { analyticsEnabled } from "@/lib/runtime-config/analytics";
import type { AnalyticsEventType } from "@/lib/analytics/events/catalog";
import { sanitizeEventProperties } from "@/lib/analytics/events/sanitize";
import { truncateStr } from "@/lib/primitives/pure";

const logger = createLogger("analytics");

const MAX_TYPE_LEN = 80;
const MAX_ID_LEN = 200;

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

function normalizeOptionalId(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed ? truncateStr(trimmed, MAX_ID_LEN) : null;
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
        type: truncateStr(input.type || "unknown", MAX_TYPE_LEN),
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
