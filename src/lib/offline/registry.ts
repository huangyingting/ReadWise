/**
 * Offline mutation type and endpoint registry (REF-021).
 *
 * Enumerates every mutation type the client may queue offline. Any route that
 * must handle idempotent replay through the mutation queue must appear here.
 * Having a single registry makes queued mutations auditable and prevents future
 * routes from silently bypassing idempotency.
 */

/** All mutation types that may be queued and replayed offline. */
export type OfflineMutationType =
  | "progress"
  | "saveWord"
  | "removeWord"
  | "highlight.create"
  | "highlight.color"
  | "highlight.note"
  | "highlight.delete"
  | "quiz.attempt"
  | "today.skip"
  | "today.read-complete"
  | "today.comprehension"
  | "today.word-review-complete";

/**
 * Client-side dedupe behaviour for a queued mutation type:
 *   - `latest-wins`: a newer mutation with the same `dedupeKey` replaces the
 *     pending one (progress-style updates — only the latest value matters).
 *   - `append-only`: every mutation is kept (each action is independently
 *     meaningful, e.g. a skip).
 */
export type DedupeBehavior = "latest-wins" | "append-only";

/** Registration record describing one allowed offline mutation type. */
export interface MutationRegistration {
  type: OfflineMutationType;
  /** Default HTTP method for this mutation type. */
  method: "POST" | "PATCH" | "DELETE";
  /** API path prefix(es) this type is allowed to target. */
  endpointPrefixes: readonly string[];
  /**
   * Optional idempotency-key template documenting the shape of the client
   * mutation id for this type, e.g. `today-skip-{userId}-{localDate}`. Present
   * for Today mutation types whose keys are derived (see
   * {@link buildTodayIdempotencyKey}).
   */
  idempotencyKeyTemplate?: string;
  /** Optional client-side dedupe behaviour (defaults to per-record/append-only). */
  dedupe?: DedupeBehavior;
}

/**
 * Canonical registry of all offline-queued mutation types.
 *
 * Each entry documents which HTTP method and endpoint prefix a mutation type
 * uses so the queue is self-describing and operators can audit it without
 * reading every caller.
 */
export const OFFLINE_MUTATION_REGISTRY: readonly MutationRegistration[] = [
  {
    type: "progress",
    method: "POST",
    endpointPrefixes: ["/api/progress"],
  },
  {
    type: "saveWord",
    method: "POST",
    endpointPrefixes: ["/api/saved-words"],
  },
  {
    type: "removeWord",
    method: "DELETE",
    endpointPrefixes: ["/api/saved-words"],
  },
  {
    type: "highlight.create",
    method: "POST",
    endpointPrefixes: ["/api/highlights"],
  },
  {
    type: "highlight.color",
    method: "PATCH",
    endpointPrefixes: ["/api/highlights"],
  },
  {
    type: "highlight.note",
    method: "PATCH",
    endpointPrefixes: ["/api/highlights"],
  },
  {
    type: "highlight.delete",
    method: "DELETE",
    endpointPrefixes: ["/api/highlights"],
  },
  {
    type: "quiz.attempt",
    method: "POST",
    endpointPrefixes: ["/api/quiz"],
  },
  // ── Today Session offline mutations (#811) ───────────────────────────────
  // Replayed into the existing, idempotent Today API routes. Payloads carry
  // controlled fields only (see TODAY_OFFLINE_PAYLOAD_FIELDS); the server
  // resolves today's primary article from the stored TodaySession, so no
  // article/word ids or content ever enter the queue.
  {
    type: "today.skip",
    method: "POST",
    endpointPrefixes: ["/api/today/skip"],
    idempotencyKeyTemplate: "today-skip-{userId}-{localDate}",
    // Each skip is its own action; never collapse skips together.
    dedupe: "append-only",
  },
  {
    type: "today.read-complete",
    method: "POST",
    endpointPrefixes: ["/api/today/read-complete"],
    idempotencyKeyTemplate: "today-read-{userId}-{localDate}",
    dedupe: "latest-wins",
  },
  {
    type: "today.comprehension",
    method: "POST",
    endpointPrefixes: ["/api/today/comprehension"],
    idempotencyKeyTemplate: "today-comp-{userId}-{localDate}",
    dedupe: "latest-wins",
  },
  {
    type: "today.word-review-complete",
    method: "POST",
    endpointPrefixes: ["/api/today/word-review-complete"],
    idempotencyKeyTemplate: "today-review-{userId}-{localDate}",
    dedupe: "latest-wins",
  },
] as const;

/** Returns true when `type` is a registered offline mutation type. */
export function isKnownMutationType(
  type: string,
): type is OfflineMutationType {
  return OFFLINE_MUTATION_REGISTRY.some((r) => r.type === type);
}

/** Look up the registration record for a mutation type, or undefined if unknown. */
export function getMutationRegistration(
  type: string,
): MutationRegistration | undefined {
  return OFFLINE_MUTATION_REGISTRY.find((r) => r.type === type);
}

// ---------------------------------------------------------------------------
// Today Session offline mutations (#811)
// ---------------------------------------------------------------------------

/**
 * The Today mutation types, in the order their steps occur. Pure constant so it
 * can be imported by both client glue (`sync-runtime.ts`) and tests.
 */
export const TODAY_OFFLINE_MUTATION_TYPES = [
  "today.skip",
  "today.read-complete",
  "today.comprehension",
  "today.word-review-complete",
] as const;

export type TodayOfflineMutationType =
  (typeof TODAY_OFFLINE_MUTATION_TYPES)[number];

/** Canonical Today endpoint for each Today mutation type. */
export const TODAY_ENDPOINT_BY_TYPE: Record<TodayOfflineMutationType, string> = {
  "today.skip": "/api/today/skip",
  "today.read-complete": "/api/today/read-complete",
  "today.comprehension": "/api/today/comprehension",
  "today.word-review-complete": "/api/today/word-review-complete",
};

/** Idempotency-key prefix for each Today mutation type. */
const TODAY_KEY_PREFIX: Record<TodayOfflineMutationType, string> = {
  "today.skip": "today-skip",
  "today.read-complete": "today-read",
  "today.comprehension": "today-comp",
  "today.word-review-complete": "today-review",
};

/** Returns true when `type` is one of the Today offline mutation types. */
export function isTodayMutationType(
  type: string,
): type is TodayOfflineMutationType {
  return (TODAY_OFFLINE_MUTATION_TYPES as readonly string[]).includes(type);
}

/**
 * The ONLY fields a Today offline mutation payload may contain. Enforced by
 * {@link isAllowedTodayPayload} and the privacy test. No article/word text,
 * definitions, prompts, answers, notes, or PII may ever be queued.
 */
export const TODAY_OFFLINE_PAYLOAD_FIELDS = [
  "localDate",
  "timezone",
  "skipReason",
  "selfRating",
  "questionId",
  "selectedIndex",
  "mcqCorrect",
] as const;

const TODAY_ALLOWED_FIELD_SET = new Set<string>(TODAY_OFFLINE_PAYLOAD_FIELDS);

/**
 * Build the client mutation id (idempotency key) for a Today mutation. The key
 * is derived ONLY from the mutation type, the authenticated `userId` (never
 * read from the payload), and the learner's local date — never from content.
 * Shape: `today-{op}-{userId}-{localDate}`.
 */
export function buildTodayIdempotencyKey(
  type: TodayOfflineMutationType,
  userId: string,
  localDate: string,
): string {
  return `${TODAY_KEY_PREFIX[type]}-${userId}-${localDate}`;
}

/** Strict `YYYY-MM-DD` local-date validation (also rejects impossible dates). */
export function isValidLocalDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const [, y, mo, d] = m;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const dt = new Date(Date.UTC(year, month - 1, day));
  return (
    dt.getUTCFullYear() === year &&
    dt.getUTCMonth() === month - 1 &&
    dt.getUTCDate() === day
  );
}

/** True when `tz` is a usable IANA timezone string (pure, client-safe). */
export function isValidTimezoneString(tz: unknown): tz is string {
  if (typeof tz !== "string" || tz.trim() === "") return false;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * True when `payload` is a plain object whose keys are ALL within
 * {@link TODAY_OFFLINE_PAYLOAD_FIELDS}. Used as a privacy backstop before a
 * Today mutation is enqueued or replayed — any unexpected (potentially
 * content-bearing) field makes the payload invalid.
 */
export function isAllowedTodayPayload(payload: unknown): boolean {
  if (payload == null || typeof payload !== "object" || Array.isArray(payload)) {
    return false;
  }
  for (const key of Object.keys(payload as Record<string, unknown>)) {
    if (!TODAY_ALLOWED_FIELD_SET.has(key)) return false;
  }
  return true;
}
