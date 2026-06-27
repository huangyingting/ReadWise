"use client";
/**
 * Today offline mutation enqueue helpers (#811).
 *
 * Thin client glue that turns a Today step action into a privacy-safe offline
 * mutation. Used by the Today UI when the device is offline: instead of a direct
 * fetch, the action is enqueued (under a deterministic per-day idempotency key)
 * and replayed later by `todayMutationReplayHandler`.
 *
 * Privacy: the queued payload carries ONLY controlled fields — `localDate`,
 * `timezone`, and the action's controlled enums/ids/booleans. Never article or
 * word text, definitions, prompts, answers, notes, or PII. The `userId` lives
 * only in the idempotency key, never in the payload body.
 */

import { submitMutation, type SubmitResult } from "./sync-runtime";
import {
  TODAY_ENDPOINT_BY_TYPE,
  buildTodayIdempotencyKey,
  getMutationRegistration,
  isAllowedTodayPayload,
  type TodayOfflineMutationType,
} from "./registry";

/** The per-day, per-user context every Today mutation is keyed on. */
export interface TodayMutationContext {
  /** Authenticated user id — used ONLY to derive the idempotency key. */
  userId: string;
  /** Learner's local calendar date, "YYYY-MM-DD". */
  localDate: string;
  /** Learner's IANA timezone (resolved on the device). */
  timezone: string;
}

/** True when the browser currently reports an offline network state. */
export function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

/**
 * Enqueue (or, if online, immediately send) a Today mutation. The payload is
 * `{ localDate, timezone, ...extra }` and is asserted to contain only allowed
 * fields before it ever reaches the queue. The idempotency key is
 * `today-{op}-{userId}-{localDate}`, so a repeated same-day action collapses to
 * one queued record.
 */
export async function submitTodayMutation(
  type: TodayOfflineMutationType,
  ctx: TodayMutationContext,
  extra: Record<string, unknown> = {},
): Promise<SubmitResult> {
  const body: Record<string, unknown> = {
    localDate: ctx.localDate,
    timezone: ctx.timezone,
    ...extra,
  };
  // Privacy backstop: refuse to queue anything outside the allowed field set.
  if (!isAllowedTodayPayload(body)) {
    throw new Error(`Disallowed field in Today offline payload for '${type}'`);
  }
  const reg = getMutationRegistration(type);
  const clientMutationId = buildTodayIdempotencyKey(
    type,
    ctx.userId,
    ctx.localDate,
  );
  return submitMutation({
    type,
    endpoint: TODAY_ENDPOINT_BY_TYPE[type],
    method: "POST",
    body,
    clientMutationId,
    dedupeKey: reg?.dedupe === "latest-wins" ? clientMutationId : undefined,
  });
}
