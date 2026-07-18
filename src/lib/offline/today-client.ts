"use client";
/**
 * Today Session action delivery.
 *
 * Owns the choice between immediate typed HTTP delivery and privacy-safe
 * IndexedDB queuing. Callers submit one controlled action and receive either
 * its server result or a queued acknowledgement; they never select an adapter
 * or construct a replay payload.
 *
 * Privacy: the queued payload carries ONLY controlled fields — `localDate`,
 * `timezone`, and the action's controlled enums/ids/booleans. Never article or
 * word text, definitions, prompts, answers, notes, or PII. The `userId` lives
 * only in the idempotency key, never in the payload body.
 */

import {
  ApiResponseError,
  requestJson,
} from "@/lib/client-fetch";
import {
  MUTATION_HEADER,
  queueMutation,
} from "./sync-runtime";
import {
  TODAY_ENDPOINT_BY_TYPE,
  buildTodayIdempotencyKey,
  getMutationRegistration,
  isAllowedTodayPayload,
  isValidLocalDate,
  isValidTimezoneString,
  type TodayOfflineMutationType,
} from "./registry";

/** The per-day, per-user context every Today action is keyed on. */
export interface TodayActionContext {
  /** Authenticated user id — used ONLY to derive the idempotency key. */
  userId: string;
  /** Learner's local calendar date, "YYYY-MM-DD". */
  localDate: string;
  /** Learner's IANA timezone (resolved on the device). */
  timezone: string;
}

export type TodayAction =
  | {
      type: "today.skip";
      skipReason: "not_interested" | "too_busy" | "too_hard" | "too_easy" | "other";
    }
  | { type: "today.read-complete" }
  | {
      type: "today.comprehension";
      selfRating: "confident" | "partial" | "confused";
      questionId?: string;
      selectedIndex?: number;
    }
  | { type: "today.word-review-complete" };

export type TodaySkipDeliveryResult = { limitReached: boolean };
export type TodayReadCompleteDeliveryResult = { updated: boolean };
export type TodayComprehensionDeliveryResult =
  | { updated: false }
  | {
      updated: true;
      mcqCorrect: boolean | null;
      remediation: { show: boolean; articleHref: string | null };
    };
export type TodayWordReviewDeliveryResult = { updated: boolean };

type TodayActionResultMap = {
  "today.skip": TodaySkipDeliveryResult;
  "today.read-complete": TodayReadCompleteDeliveryResult;
  "today.comprehension": TodayComprehensionDeliveryResult;
  "today.word-review-complete": TodayWordReviewDeliveryResult;
};

export type TodayActionOutcome<T extends TodayAction["type"]> =
  | { kind: "delivered"; result: TodayActionResultMap[T] }
  | { kind: "queued" };

function isOnline(): boolean {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

function actionFields(action: TodayAction): Record<string, unknown> {
  switch (action.type) {
    case "today.skip":
      return { skipReason: action.skipReason };
    case "today.read-complete":
    case "today.word-review-complete":
      return {};
    case "today.comprehension":
      return {
        selfRating: action.selfRating,
        ...(action.questionId ? { questionId: action.questionId } : {}),
        ...(action.selectedIndex != null ? { selectedIndex: action.selectedIndex } : {}),
      };
  }
}

function assertValidContext(ctx: TodayActionContext): void {
  if (!isValidLocalDate(ctx.localDate)) {
    throw new Error("Invalid Today action local date");
  }
  if (!isValidTimezoneString(ctx.timezone)) {
    throw new Error("Invalid Today action timezone");
  }
}

function isTransientStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

/**
 * Submit one Today Session action through immediate HTTP or the offline queue.
 * Delivered outcomes carry the action's typed response; queued outcomes never
 * fabricate a server result. Permanent HTTP failures preserve ApiResponseError.
 */
export async function submitTodayAction<A extends TodayAction>(
  ctx: TodayActionContext,
  action: A,
): Promise<TodayActionOutcome<A["type"]>> {
  assertValidContext(ctx);

  const fields = actionFields(action);
  const queuedBody = todayPayload(ctx, fields);
  if (!isAllowedTodayPayload(queuedBody)) {
    throw new Error(`Disallowed field in Today action payload for '${action.type}'`);
  }

  const clientMutationId = todayClientMutationId(action.type, ctx);
  const endpoint = TODAY_ENDPOINT_BY_TYPE[action.type];

  if (isOnline()) {
    try {
      const result = await requestJson<TodayActionResultMap[A["type"]]>(
        endpoint,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            [MUTATION_HEADER]: clientMutationId,
          },
          body: JSON.stringify({ ...fields, timezone: ctx.timezone }),
        },
      );
      return { kind: "delivered", result };
    } catch (error) {
      if (error instanceof ApiResponseError && !isTransientStatus(error.status)) {
        throw error;
      }
    }
  }

  const registration = getMutationRegistration(action.type);
  await queueMutation({
    type: action.type,
    endpoint,
    method: "POST",
    body: queuedBody,
    clientMutationId,
    dedupeKey: registration?.dedupe === "latest-wins" ? clientMutationId : undefined,
  });
  return { kind: "queued" };
}

function todayPayload(
  ctx: TodayActionContext,
  extra: Record<string, unknown>,
): Record<string, unknown> {
  return {
    localDate: ctx.localDate,
    timezone: ctx.timezone,
    ...extra,
  };
}

function todayClientMutationId(
  type: TodayOfflineMutationType,
  ctx: TodayActionContext,
): string {
  return buildTodayIdempotencyKey(type, ctx.userId, ctx.localDate);
}
