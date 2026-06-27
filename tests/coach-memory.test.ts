/**
 * Tests for privacy-safe learning coach memory (#810).
 *
 * Covers: upsertCoachMemory create/update + evidenceCount cap (100) + trend
 * recompute; the privacy allowlist guard; buildTutorContext bounded + aggregate
 * only + stale down-weighting; coachMemorySkillConfidences fallback contract;
 * deleteCoachMemory leaving SkillMastery intact; and the best-effort
 * SkillMastery hook (never throws).
 *
 * All Prisma access is mocked with in-memory stores — no DB/network.
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

type Row = Record<string, unknown>;

let coachStore: Map<string, Row>;
let skillStore: Map<string, Row>;
let coachThrows: boolean;

const keyOf = (userId: string, skill: string) => `${userId}::${skill}`;

function pick(row: Row, select?: Record<string, boolean>): Row {
  if (!select) return row;
  const out: Row = {};
  for (const k of Object.keys(select)) out[k] = row[k];
  return out;
}

before(() => {
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        learnerCoachMemory: {
          findUnique: async ({
            where,
            select,
          }: {
            where: { userId_skill: { userId: string; skill: string } };
            select?: Record<string, boolean>;
          }) => {
            if (coachThrows) throw new Error("coach memory backend down");
            const { userId, skill } = where.userId_skill;
            const row = coachStore.get(keyOf(userId, skill));
            return row ? pick(row, select) : null;
          },
          upsert: async ({
            where,
            create,
            update,
            select,
          }: {
            where: { userId_skill: { userId: string; skill: string } };
            create: Row;
            update: Row;
            select?: Record<string, boolean>;
          }) => {
            if (coachThrows) throw new Error("coach memory backend down");
            const { userId, skill } = where.userId_skill;
            const k = keyOf(userId, skill);
            const existing = coachStore.get(k);
            const now = new Date();
            const row: Row = existing
              ? { ...existing, ...update, updatedAt: now }
              : { createdAt: now, updatedAt: now, ...create };
            coachStore.set(k, row);
            return pick(row, select);
          },
          findMany: async ({
            where,
            select,
          }: {
            where: { userId: string };
            select?: Record<string, boolean>;
          }) =>
            [...coachStore.values()]
              .filter((r) => r.userId === where.userId)
              .map((r) => pick(r, select)),
          deleteMany: async ({ where }: { where: { userId: string } }) => {
            let count = 0;
            for (const [k, r] of [...coachStore.entries()]) {
              if (r.userId === where.userId) {
                coachStore.delete(k);
                count++;
              }
            }
            return { count };
          },
        },
        skillMastery: {
          findUnique: async ({
            where,
          }: {
            where: { userId_skill: { userId: string; skill: string } };
          }) => {
            const { userId, skill } = where.userId_skill;
            return skillStore.get(keyOf(userId, skill)) ?? null;
          },
          findMany: async ({ where }: { where: { userId: string } }) =>
            [...skillStore.values()].filter((r) => r.userId === where.userId),
          upsert: async ({
            where,
            create,
            update,
          }: {
            where: { userId_skill: { userId: string; skill: string } };
            create: Row;
            update: Row;
          }) => {
            const { userId, skill } = where.userId_skill;
            const k = keyOf(userId, skill);
            const existing = skillStore.get(k);
            const row = existing ? { ...existing, ...update } : { userId, skill, ...create };
            skillStore.set(k, row);
            return row;
          },
        },
      },
    },
  });

  // getProfile is pulled in transitively by skill-mastery — keep it inert.
  mock.module("@/lib/profile", {
    namedExports: { getProfile: async () => null },
  });
});

beforeEach(() => {
  coachStore = new Map();
  skillStore = new Map();
  coachThrows = false;
});

const DAY = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// upsertCoachMemory — create / update / cap / trend
// ---------------------------------------------------------------------------

test("upsertCoachMemory creates a stable entry from the first observation", async () => {
  const { upsertCoachMemory } = await import("@/lib/learning/coach-memory");
  const rec = await upsertCoachMemory("u1", { skill: "comprehension", confidence: 0.4 });
  assert.ok(rec);
  assert.equal(rec!.skill, "comprehension");
  assert.equal(rec!.confidence, 0.4);
  assert.equal(rec!.evidenceCount, 1);
  assert.equal(rec!.trend, "stable");
});

test("upsertCoachMemory blends confidence and reports an improving trend", async () => {
  const { upsertCoachMemory } = await import("@/lib/learning/coach-memory");
  await upsertCoachMemory("u1", { skill: "vocabulary", confidence: 0.4 });
  const rec = await upsertCoachMemory("u1", { skill: "vocabulary", confidence: 1.0 });
  assert.ok(rec);
  assert.ok(rec!.confidence > 0.4 && rec!.confidence < 1.0, "EMA blend");
  assert.equal(rec!.evidenceCount, 2);
  assert.equal(rec!.trend, "improving");
});

test("upsertCoachMemory reports a declining trend when confidence drops", async () => {
  const { upsertCoachMemory } = await import("@/lib/learning/coach-memory");
  await upsertCoachMemory("u1", { skill: "grammar", confidence: 0.8 });
  const rec = await upsertCoachMemory("u1", { skill: "grammar", confidence: 0.0 });
  assert.ok(rec);
  assert.equal(rec!.trend, "declining");
});

test("upsertCoachMemory caps evidenceCount at 100", async () => {
  const { upsertCoachMemory, EVIDENCE_COUNT_CAP } = await import(
    "@/lib/learning/coach-memory"
  );
  coachStore.set(keyOf("u1", "reading"), {
    userId: "u1",
    skill: "reading",
    confidence: 0.5,
    evidenceCount: 100,
    lastObservedAt: new Date(),
    trend: "stable",
  });
  const rec = await upsertCoachMemory("u1", { skill: "reading", confidence: 0.6 });
  assert.equal(rec!.evidenceCount, EVIDENCE_COUNT_CAP);
  assert.equal(EVIDENCE_COUNT_CAP, 100);
});

test("upsertCoachMemory drops observations for unknown skill keys", async () => {
  const { upsertCoachMemory } = await import("@/lib/learning/coach-memory");
  const rec = await upsertCoachMemory("u1", {
    skill: "telepathy" as never,
    confidence: 0.5,
  });
  assert.equal(rec, null);
  assert.equal(coachStore.size, 0);
});

// ---------------------------------------------------------------------------
// Privacy guard — forbidden fields rejected with a typed error
// ---------------------------------------------------------------------------

for (const banned of [
  "prompt",
  "text",
  "definition",
  "example",
  "contextSentence",
  "note",
  "token",
  "articleId",
  "sessionId",
]) {
  test(`upsertCoachMemory rejects forbidden field "${banned}"`, async () => {
    const { upsertCoachMemory, CoachMemoryPrivacyError } = await import(
      "@/lib/learning/coach-memory"
    );
    await assert.rejects(
      () =>
        upsertCoachMemory("u1", {
          skill: "vocabulary",
          confidence: 0.5,
          [banned]: "leaked private content",
        } as never),
      (err: unknown) => {
        assert.ok(err instanceof CoachMemoryPrivacyError);
        assert.match((err as Error).message, new RegExp(banned));
        return true;
      },
    );
    // Nothing was persisted.
    assert.equal(coachStore.size, 0);
  });
}

// ---------------------------------------------------------------------------
// buildTutorContext — bounded, aggregates only, stale down-weighting
// ---------------------------------------------------------------------------

const TUTOR_LINE = /^- [a-z_]+: confidence \d\.\d\d \((improving|stable|declining), \d+ observations\)$/;

test("buildTutorContext returns an empty string when there is no memory", async () => {
  const { buildTutorContext } = await import("@/lib/learning/coach-memory");
  assert.equal(await buildTutorContext("u1"), "");
});

test("buildTutorContext emits only controlled aggregates, never raw content", async () => {
  const { buildTutorContext, MAX_TUTOR_CONTEXT_TOKENS } = await import(
    "@/lib/learning/coach-memory"
  );
  const now = new Date();
  coachStore.set(keyOf("u1", "comprehension"), {
    userId: "u1",
    skill: "comprehension",
    confidence: 0.42,
    evidenceCount: 8,
    lastObservedAt: now,
    trend: "declining",
  });
  coachStore.set(keyOf("u1", "vocabulary"), {
    userId: "u1",
    skill: "vocabulary",
    confidence: 0.51,
    evidenceCount: 15,
    lastObservedAt: now,
    trend: "stable",
  });

  const summary = await buildTutorContext("u1", now);
  const lines = summary.split("\n");
  assert.equal(lines[0], "Skill weaknesses (structured summary only):");
  for (const line of lines.slice(1)) {
    assert.match(line, TUTOR_LINE, `line must be a controlled aggregate: ${line}`);
  }
  // Weakest first.
  assert.ok(lines[1].startsWith("- comprehension:"));
  // Bounded token budget (~4 chars/token).
  assert.ok(Math.ceil(summary.length / 4) <= MAX_TUTOR_CONTEXT_TOKENS);
  // No private content leaks.
  assert.doesNotMatch(summary, /article|prompt|sentence|definition|http/i);
});

test("buildTutorContext down-weights stale entries in the ranking", async () => {
  const { buildTutorContext } = await import("@/lib/learning/coach-memory");
  const now = new Date();
  // Fresh entry: weakness 0.50. Stale entry: raw weakness 0.70 but, weighted at
  // 50%, effective weakness 0.35 — so the fresh one should rank first.
  coachStore.set(keyOf("u1", "vocabulary"), {
    userId: "u1",
    skill: "vocabulary",
    confidence: 0.5,
    evidenceCount: 4,
    lastObservedAt: now,
    trend: "stable",
  });
  coachStore.set(keyOf("u1", "grammar"), {
    userId: "u1",
    skill: "grammar",
    confidence: 0.3,
    evidenceCount: 4,
    lastObservedAt: new Date(now.getTime() - 200 * DAY),
    trend: "stable",
  });
  const summary = await buildTutorContext("u1", now);
  const lines = summary.split("\n").slice(1);
  assert.ok(lines[0].startsWith("- vocabulary:"), "fresh weakness ranks above stale");
});

// ---------------------------------------------------------------------------
// coachMemorySkillConfidences — fallback contract
// ---------------------------------------------------------------------------

test("coachMemorySkillConfidences returns an empty map when there is no memory", async () => {
  const { coachMemorySkillConfidences } = await import("@/lib/learning/coach-memory");
  const map = await coachMemorySkillConfidences("u1");
  assert.equal(map.size, 0);
});

test("coachMemorySkillConfidences applies stale weighting", async () => {
  const { coachMemorySkillConfidences } = await import("@/lib/learning/coach-memory");
  const now = new Date();
  coachStore.set(keyOf("u1", "grammar"), {
    userId: "u1",
    skill: "grammar",
    confidence: 0.3,
    evidenceCount: 4,
    lastObservedAt: new Date(now.getTime() - 200 * DAY),
    trend: "stable",
  });
  const map = await coachMemorySkillConfidences("u1", now);
  // 1 - (1 - 0.3) * 0.5 = 0.65
  assert.ok(Math.abs(map.get("grammar")! - 0.65) < 1e-9);
});

// ---------------------------------------------------------------------------
// deleteCoachMemory — user-scoped, leaves SkillMastery intact
// ---------------------------------------------------------------------------

test("deleteCoachMemory removes the user's rows but never SkillMastery", async () => {
  const { deleteCoachMemory } = await import("@/lib/learning/coach-memory");
  coachStore.set(keyOf("u1", "reading"), {
    userId: "u1",
    skill: "reading",
    confidence: 0.5,
    evidenceCount: 3,
    lastObservedAt: new Date(),
    trend: "stable",
  });
  coachStore.set(keyOf("u2", "reading"), {
    userId: "u2",
    skill: "reading",
    confidence: 0.6,
    evidenceCount: 2,
    lastObservedAt: new Date(),
    trend: "stable",
  });
  skillStore.set(keyOf("u1", "reading"), {
    userId: "u1",
    skill: "reading",
    confidence: 0.7,
    evidenceCount: 9,
  });

  const removed = await deleteCoachMemory("u1");
  assert.equal(removed, 1);
  assert.equal(coachStore.has(keyOf("u1", "reading")), false);
  // Other users untouched.
  assert.equal(coachStore.has(keyOf("u2", "reading")), true);
  // SkillMastery (source of truth) is preserved.
  assert.equal(skillStore.has(keyOf("u1", "reading")), true);
});

// ---------------------------------------------------------------------------
// SkillMastery hook — best-effort, never throws
// ---------------------------------------------------------------------------

test("syncCoachMemory swallows backend failures (best-effort)", async () => {
  const { syncCoachMemory } = await import("@/lib/learning/coach-memory");
  coachThrows = true;
  await assert.doesNotReject(() => syncCoachMemory("u1", "reading", 0.5));
});

test("recordSkillEvidence still succeeds when the coach-memory side effect throws", async () => {
  const { recordSkillEvidence } = await import("@/lib/learning/skill-mastery");
  coachThrows = true; // coach memory writes will blow up
  const summary = await recordSkillEvidence("u1", "reading", 0.9);
  assert.ok(summary, "mastery write must succeed despite coach-memory failure");
  assert.equal(summary!.skill, "reading");
  // The SkillMastery row was written (source of truth unaffected).
  assert.equal(skillStore.has(keyOf("u1", "reading")), true);
});

test("recordSkillEvidence syncs coach memory as a side effect on success", async () => {
  const { recordSkillEvidence } = await import("@/lib/learning/skill-mastery");
  await recordSkillEvidence("u1", "vocabulary", 0.3);
  const row = coachStore.get(keyOf("u1", "vocabulary"));
  assert.ok(row, "coach memory should be synced from the mastery write");
  assert.equal(row!.skill, "vocabulary");
  assert.equal(row!.evidenceCount, 1);
});
