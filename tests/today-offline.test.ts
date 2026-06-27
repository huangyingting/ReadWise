/**
 * Today Session offline mutation support (#811).
 *
 * Covers the pure registry additions (4 Today mutation types, idempotency keys,
 * payload allow-list, validators) and the `todayMutationReplayHandler` replay
 * policy (success → remove; 409 → conflict + content-free analytics; network /
 * transient → retry+backoff; invalid → failed), including the three conflict
 * scenarios from the design table, plus a privacy assertion that queued Today
 * payloads can only carry allowed fields.
 *
 * Pure logic — all I/O is injected, so no IndexedDB / network / DOM is touched.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  OFFLINE_MUTATION_REGISTRY,
  getMutationRegistration,
  isKnownMutationType,
  isTodayMutationType,
  isAllowedTodayPayload,
  isValidLocalDate,
  isValidTimezoneString,
  buildTodayIdempotencyKey,
  TODAY_OFFLINE_MUTATION_TYPES,
  TODAY_ENDPOINT_BY_TYPE,
  TODAY_OFFLINE_PAYLOAD_FIELDS,
  type TodayOfflineMutationType,
} from "@/lib/offline/registry";
import {
  todayMutationReplayHandler,
  type TodayReplayDeps,
  type TodayConflictInfo,
} from "@/lib/offline/sync-runtime";
import {
  MAX_MUTATION_RETRIES,
  type QueuedMutation,
} from "@/lib/offline-sync";

const USER = "user-1";
const LOCAL_DATE = "2026-06-27";

// ---------------------------------------------------------------------------
// Registry: the four Today mutation types
// ---------------------------------------------------------------------------

const EXPECTED: Array<{
  type: TodayOfflineMutationType;
  endpoint: string;
  key: string;
  dedupe: "latest-wins" | "append-only";
}> = [
  {
    type: "today.skip",
    endpoint: "/api/today/skip",
    key: "today-skip-user-1-2026-06-27",
    dedupe: "append-only",
  },
  {
    type: "today.read-complete",
    endpoint: "/api/today/read-complete",
    key: "today-read-user-1-2026-06-27",
    dedupe: "latest-wins",
  },
  {
    type: "today.comprehension",
    endpoint: "/api/today/comprehension",
    key: "today-comp-user-1-2026-06-27",
    dedupe: "latest-wins",
  },
  {
    type: "today.word-review-complete",
    endpoint: "/api/today/word-review-complete",
    key: "today-review-user-1-2026-06-27",
    dedupe: "latest-wins",
  },
];

test("registry exposes all four Today mutation types as known POST entries", () => {
  for (const exp of EXPECTED) {
    assert.equal(isKnownMutationType(exp.type), true, `known: ${exp.type}`);
    assert.equal(isTodayMutationType(exp.type), true, `today: ${exp.type}`);
    const reg = getMutationRegistration(exp.type);
    assert.ok(reg, `registration exists for ${exp.type}`);
    assert.equal(reg!.method, "POST");
    assert.deepEqual(reg!.endpointPrefixes, [exp.endpoint]);
    assert.equal(reg!.dedupe, exp.dedupe);
    assert.equal(TODAY_ENDPOINT_BY_TYPE[exp.type], exp.endpoint);
  }
});

test("registry has correct idempotency-key templates and builder output", () => {
  for (const exp of EXPECTED) {
    const reg = getMutationRegistration(exp.type);
    const prefix = exp.key.slice(0, exp.key.indexOf("-user"));
    assert.equal(
      reg!.idempotencyKeyTemplate,
      `${prefix}-{userId}-{localDate}`,
      `template for ${exp.type}`,
    );
    assert.equal(
      buildTodayIdempotencyKey(exp.type, USER, LOCAL_DATE),
      exp.key,
      `key for ${exp.type}`,
    );
  }
});

test("idempotency keys never embed content — only op + userId + localDate", () => {
  const key = buildTodayIdempotencyKey("today.skip", USER, LOCAL_DATE);
  assert.equal(key, `today-skip-${USER}-${LOCAL_DATE}`);
  // The same key for the same day → repeated same-day actions collapse.
  assert.equal(
    buildTodayIdempotencyKey("today.skip", USER, LOCAL_DATE),
    key,
  );
});

test("TODAY_OFFLINE_MUTATION_TYPES lists exactly the four Today types", () => {
  assert.deepEqual([...TODAY_OFFLINE_MUTATION_TYPES], EXPECTED.map((e) => e.type));
});

test("isTodayMutationType rejects non-Today types", () => {
  assert.equal(isTodayMutationType("progress"), false);
  assert.equal(isTodayMutationType("quiz.attempt"), false);
  assert.equal(isTodayMutationType("today"), false);
  assert.equal(isTodayMutationType(""), false);
});

test("the Today registry entries do not regress the existing entries", () => {
  // Registry still contains the v1 reader mutations untouched.
  assert.ok(getMutationRegistration("progress"));
  assert.ok(getMutationRegistration("quiz.attempt"));
  // And every entry is uniquely typed.
  const types = OFFLINE_MUTATION_REGISTRY.map((r) => r.type);
  assert.equal(new Set(types).size, types.length);
});

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

test("isValidLocalDate accepts YYYY-MM-DD and rejects junk / impossible dates", () => {
  assert.equal(isValidLocalDate("2026-06-27"), true);
  assert.equal(isValidLocalDate("2026-02-28"), true);
  assert.equal(isValidLocalDate("2026-13-01"), false, "month 13");
  assert.equal(isValidLocalDate("2026-02-30"), false, "feb 30");
  assert.equal(isValidLocalDate("2026-6-7"), false, "needs zero-pad");
  assert.equal(isValidLocalDate("not-a-date"), false);
  assert.equal(isValidLocalDate(20260627 as unknown), false);
  assert.equal(isValidLocalDate(undefined as unknown), false);
});

test("isValidTimezoneString accepts IANA zones and rejects invalid ones", () => {
  assert.equal(isValidTimezoneString("UTC"), true);
  assert.equal(isValidTimezoneString("America/New_York"), true);
  assert.equal(isValidTimezoneString("Not/AZone"), false);
  assert.equal(isValidTimezoneString(""), false);
  assert.equal(isValidTimezoneString(123 as unknown), false);
});

// ---------------------------------------------------------------------------
// Privacy: payload allow-list
// ---------------------------------------------------------------------------

test("TODAY_OFFLINE_PAYLOAD_FIELDS is exactly the documented allow-list", () => {
  assert.deepEqual(
    [...TODAY_OFFLINE_PAYLOAD_FIELDS].sort(),
    [
      "localDate",
      "mcqCorrect",
      "questionId",
      "selectedIndex",
      "selfRating",
      "skipReason",
      "timezone",
    ],
  );
});

test("isAllowedTodayPayload accepts the per-type payloads the UI builds", () => {
  const skip = { localDate: LOCAL_DATE, timezone: "UTC", skipReason: "too_busy" };
  const read = { localDate: LOCAL_DATE, timezone: "UTC" };
  const comp = {
    localDate: LOCAL_DATE,
    timezone: "UTC",
    selfRating: "confident",
    questionId: "q1",
    selectedIndex: 2,
  };
  const review = { localDate: LOCAL_DATE, timezone: "UTC" };
  for (const p of [skip, read, comp, review]) {
    assert.equal(isAllowedTodayPayload(p), true);
  }
});

test("isAllowedTodayPayload rejects any content/PII-bearing field", () => {
  for (const banned of [
    { localDate: LOCAL_DATE, articleText: "the article body" },
    { localDate: LOCAL_DATE, wordText: "ephemeral" },
    { localDate: LOCAL_DATE, definition: "lasting a short time" },
    { localDate: LOCAL_DATE, prompt: "explain the passage" },
    { localDate: LOCAL_DATE, questionText: "what is X?" },
    { localDate: LOCAL_DATE, email: "user@example.com" },
    { localDate: LOCAL_DATE, userId: "user-1" },
    { localDate: LOCAL_DATE, articleId: "a1" },
  ]) {
    assert.equal(
      isAllowedTodayPayload(banned),
      false,
      `should reject: ${Object.keys(banned).join(",")}`,
    );
  }
  assert.equal(isAllowedTodayPayload(null), false);
  assert.equal(isAllowedTodayPayload([{ localDate: LOCAL_DATE }]), false);
});

// ---------------------------------------------------------------------------
// todayMutationReplayHandler
// ---------------------------------------------------------------------------

function todayMut(
  type: TodayOfflineMutationType,
  payload: Record<string, unknown> = { localDate: LOCAL_DATE, timezone: "UTC" },
  partial: Partial<QueuedMutation> = {},
): QueuedMutation {
  return {
    clientMutationId:
      partial.clientMutationId ?? buildTodayIdempotencyKey(type, USER, LOCAL_DATE),
    type,
    endpoint: TODAY_ENDPOINT_BY_TYPE[type],
    method: "POST",
    payload,
    createdAt: partial.createdAt ?? "2026-06-27T08:00:00.000Z",
    retryCount: partial.retryCount ?? 0,
    status: partial.status ?? "pending",
    lastError: partial.lastError ?? null,
    dedupeKey: partial.dedupeKey ?? null,
  };
}

interface Recorder {
  removed: string[];
  updated: Array<{ id: string; patch: Partial<QueuedMutation> }>;
  conflicts: TodayConflictInfo[];
  deps: TodayReplayDeps;
}

function recorder(send: TodayReplayDeps["send"]): Recorder {
  const removed: string[] = [];
  const updated: Array<{ id: string; patch: Partial<QueuedMutation> }> = [];
  const conflicts: TodayConflictInfo[] = [];
  return {
    removed,
    updated,
    conflicts,
    deps: {
      send,
      remove: async (id) => {
        removed.push(id);
      },
      update: async (id, patch) => {
        updated.push({ id, patch });
      },
      onConflict: (info) => {
        conflicts.push(info);
      },
    },
  };
}

test("replay: a 200 removes the mutation from the queue", async () => {
  const m = todayMut("today.read-complete");
  const r = recorder(async () => ({ status: 200 }));
  const outcome = await todayMutationReplayHandler(m, r.deps);
  assert.equal(outcome, "removed");
  assert.deepEqual(r.removed, [m.clientMutationId]);
  assert.equal(r.updated.length, 0);
  assert.equal(r.conflicts.length, 0);
});

test("replay: a 409 marks the mutation conflict and emits content-free analytics", async () => {
  const m = todayMut("today.skip", {
    localDate: LOCAL_DATE,
    timezone: "UTC",
    skipReason: "too_busy",
  });
  const r = recorder(async () => ({ status: 409 }));
  const outcome = await todayMutationReplayHandler(m, r.deps);
  assert.equal(outcome, "conflict");
  assert.equal(r.removed.length, 0);
  assert.equal(r.updated.length, 1);
  assert.equal(r.updated[0].patch.status, "conflict");
  // Analytics carries ids/status ONLY — no payload content.
  assert.equal(r.conflicts.length, 1);
  assert.deepEqual(Object.keys(r.conflicts[0]).sort(), [
    "mutationType",
    "statusCode",
  ]);
  assert.equal(r.conflicts[0].mutationType, "today.skip");
  assert.equal(r.conflicts[0].statusCode, 409);
});

test("replay: a network error increments retryCount and stays pending (back-off)", async () => {
  const m = todayMut("today.word-review-complete", undefined, { retryCount: 1 });
  const r = recorder(async () => {
    throw new Error("network down");
  });
  const outcome = await todayMutationReplayHandler(m, r.deps);
  assert.equal(outcome, "retry");
  assert.equal(r.updated.length, 1);
  assert.equal(r.updated[0].patch.status, "pending");
  assert.equal(r.updated[0].patch.retryCount, 2);
  assert.equal(r.removed.length, 0);
  assert.equal(r.conflicts.length, 0);
});

test("replay: a 5xx is a transient retry; exhausting retries flags failed", async () => {
  const transient = recorder(async () => ({ status: 503 }));
  const out1 = await todayMutationReplayHandler(
    todayMut("today.read-complete", undefined, { retryCount: 0 }),
    transient.deps,
  );
  assert.equal(out1, "retry");
  assert.equal(transient.updated[0].patch.status, "pending");

  const exhausted = recorder(async () => ({ status: 503 }));
  const out2 = await todayMutationReplayHandler(
    todayMut("today.read-complete", undefined, {
      retryCount: MAX_MUTATION_RETRIES - 1,
    }),
    exhausted.deps,
  );
  assert.equal(out2, "failed");
  assert.equal(exhausted.updated[0].patch.status, "failed");
});

test("replay: an invalid/content-bearing payload is failed, never sent", async () => {
  let sent = 0;
  // Banned field present → must not be delivered.
  const r = recorder(async () => {
    sent++;
    return { status: 200 };
  });
  const m = todayMut("today.skip", {
    localDate: LOCAL_DATE,
    articleText: "secret body",
  });
  const outcome = await todayMutationReplayHandler(m, r.deps);
  assert.equal(outcome, "invalid");
  assert.equal(sent, 0, "must not POST a disallowed payload");
  assert.equal(r.updated[0].patch.status, "failed");
});

test("replay: a malformed localDate is rejected before sending", async () => {
  let sent = 0;
  const r = recorder(async () => {
    sent++;
    return { status: 200 };
  });
  const m = todayMut("today.skip", { localDate: "27-06-2026", timezone: "UTC" });
  const outcome = await todayMutationReplayHandler(m, r.deps);
  assert.equal(outcome, "invalid");
  assert.equal(sent, 0);
});

test("replay: other 4xx (e.g. 400) is a permanent failure", async () => {
  const r = recorder(async () => ({ status: 400 }));
  const outcome = await todayMutationReplayHandler(
    todayMut("today.comprehension", {
      localDate: LOCAL_DATE,
      timezone: "UTC",
      selfRating: "confident",
    }),
    r.deps,
  );
  assert.equal(outcome, "failed");
  assert.equal(r.updated[0].patch.status, "failed");
});

// ---------------------------------------------------------------------------
// The three conflict-resolution scenarios from the design table
// ---------------------------------------------------------------------------

test("scenario 1: already-completed skip on another device → conflict (409)", async () => {
  const m = todayMut("today.skip", {
    localDate: LOCAL_DATE,
    timezone: "UTC",
    skipReason: "too_busy",
  });
  const r = recorder(async () => ({ status: 409 }));
  const outcome = await todayMutationReplayHandler(m, r.deps);
  assert.equal(outcome, "conflict");
  assert.equal(r.updated[0].patch.status, "conflict");
  assert.equal(r.conflicts[0].mutationType, "today.skip");
});

test("scenario 2: read-complete after the primary article was swapped → idempotent no-op (200)", async () => {
  // The server hook is a no-op when the primary id changed; it still returns 200.
  const m = todayMut("today.read-complete");
  const r = recorder(async () => ({ status: 200 }));
  const outcome = await todayMutationReplayHandler(m, r.deps);
  assert.equal(outcome, "removed", "idempotent no-op drops cleanly from the queue");
  assert.equal(r.conflicts.length, 0, "no conflict UI for a silent no-op");
});

test("scenario 3: concurrent word-review on two devices → monotonic no-op (200)", async () => {
  const m = todayMut("today.word-review-complete");
  const r = recorder(async () => ({ status: 200 }));
  const outcome = await todayMutationReplayHandler(m, r.deps);
  assert.equal(outcome, "removed");
  assert.equal(r.conflicts.length, 0, "monotonic second write needs no conflict UI");
});
