/**
 * Tests for skill mastery & CEFR confidence tracking (RW-038).
 *
 * Mocks: @/lib/prisma (in-memory skillMastery store + controllable profile).
 * profile-preferences repository runs for real (it only reads prisma.profile).
 * No DB/network.
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// In-memory skillMastery store + controllable profile
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;
let skillStore: Map<string, Row>;
let profileRow: Row | null;

const keyOf = (userId: string, skill: string) => `${userId}::${skill}`;

before(() => {
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        profile: {
          findUnique: async () => profileRow,
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
            const row = existing
              ? { ...existing, ...update }
              : { userId, skill, ...create };
            skillStore.set(k, row);
            return row;
          },
        },
      },
    },
  });
});

beforeEach(() => {
  skillStore = new Map();
  profileRow = { userId: "u1", englishLevel: "B1", completedAt: new Date() };
});

// ---------------------------------------------------------------------------
// recordSkillEvidence
// ---------------------------------------------------------------------------

test("first evidence sets the confidence baseline to the outcome", async () => {
  const { recordSkillEvidence } = await import("@/lib/learning/skill-mastery");
  const rec = await recordSkillEvidence("u1", "reading", 0.7);
  assert.ok(rec);
  assert.equal(rec!.skill, "reading");
  assert.ok(Math.abs(rec!.confidence - 0.7) < 1e-9, `baseline = outcome (${rec!.confidence})`);
  assert.equal(rec!.evidenceCount, 1);
  assert.equal(rec!.hasEvidence, true);
});

test("subsequent evidence blends in via an EMA (moves toward new outcomes)", async () => {
  const { recordSkillEvidence } = await import("@/lib/learning/skill-mastery");
  await recordSkillEvidence("u1", "reading", 0.2);
  const rec = await recordSkillEvidence("u1", "reading", 1);
  assert.ok(rec!.confidence > 0.2 && rec!.confidence < 1, `EMA between (${rec!.confidence})`);
  assert.equal(rec!.evidenceCount, 2);
});

test("an unknown skill name is ignored (returns null)", async () => {
  const { recordSkillEvidence } = await import("@/lib/learning/skill-mastery");
  // @ts-expect-error intentionally invalid skill
  const rec = await recordSkillEvidence("u1", "telepathy", 1);
  assert.equal(rec, null);
});

// ---------------------------------------------------------------------------
// getSkillProfile
// ---------------------------------------------------------------------------

test("getSkillProfile reports all six skills; un-evidenced ones are 0/hasEvidence:false", async () => {
  const { recordSkillEvidence, getSkillProfile } = await import("@/lib/learning/skill-mastery");
  const { SKILLS } = await import("@/lib/learning/types");
  await recordSkillEvidence("u1", "reading", 0.8);
  await recordSkillEvidence("u1", "vocabulary", 0.4);
  await recordSkillEvidence("u1", "comprehension", 0.6);

  const profile = await getSkillProfile("u1");
  assert.equal(profile.skills.length, SKILLS.length);
  const evidenced = profile.skills.filter((s) => s.hasEvidence).map((s) => s.skill);
  assert.deepEqual(evidenced.sort(), ["comprehension", "reading", "vocabulary"]);
  const grammar = profile.skills.find((s) => s.skill === "grammar")!;
  assert.equal(grammar.confidence, 0);
  assert.equal(grammar.hasEvidence, false);
  assert.equal(profile.weakest, "vocabulary", "lowest-confidence evidenced skill");
  assert.equal(profile.strongest, "reading");
  assert.ok(profile.overallConfidence > 0);
});

test("skill updates accumulate across multiple activity types", async () => {
  const { recordSkillEvidence, getSkillProfile } = await import("@/lib/learning/skill-mastery");
  // Simulate quiz → comprehension/reading, vocabulary review, pronunciation, grammar.
  await recordSkillEvidence("u1", "comprehension", 0.9);
  await recordSkillEvidence("u1", "reading", 0.9, 0.5);
  await recordSkillEvidence("u1", "vocabulary", 0.75);
  await recordSkillEvidence("u1", "pronunciation", 0.8);
  await recordSkillEvidence("u1", "listening", 0.7, 0.5);
  await recordSkillEvidence("u1", "grammar", 0.5, 0.3);

  const profile = await getSkillProfile("u1");
  assert.equal(profile.totalEvidence, 6);
  assert.equal(profile.skills.every((s) => s.hasEvidence), true);
});

// ---------------------------------------------------------------------------
// recommendLevelChange (explained)
// ---------------------------------------------------------------------------

test("recommendLevelChange holds and explains when evidence is insufficient", async () => {
  const { recordSkillEvidence, recommendLevelChange } = await import("@/lib/learning/skill-mastery");
  await recordSkillEvidence("u1", "reading", 0.9);
  const rec = await recommendLevelChange("u1");
  assert.equal(rec.suggestion, "hold");
  assert.ok(rec.reasons.length > 0);
  assert.match(rec.reasons[0], /Not enough/i);
});

test("recommendLevelChange suggests UP with reasons citing strong skills", async () => {
  const { recordSkillEvidence, recommendLevelChange } = await import("@/lib/learning/skill-mastery");
  // Two skills, ≥4 total evidence, all high confidence, none weak.
  await recordSkillEvidence("u1", "reading", 0.9);
  await recordSkillEvidence("u1", "reading", 0.9);
  await recordSkillEvidence("u1", "comprehension", 0.9);
  await recordSkillEvidence("u1", "comprehension", 0.9);

  const rec = await recommendLevelChange("u1");
  assert.equal(rec.suggestion, "up");
  assert.equal(rec.currentLevel, "B1");
  assert.equal(rec.targetLevel, "B2");
  assert.ok(rec.reasons.length >= 2);
  assert.ok(
    rec.reasons.some((r) => /reading|comprehension/i.test(r)),
    "explains which skills justify the level-up",
  );
});

test("recommendLevelChange suggests DOWN when overall confidence is low", async () => {
  const { recordSkillEvidence, recommendLevelChange } = await import("@/lib/learning/skill-mastery");
  await recordSkillEvidence("u1", "reading", 0.2);
  await recordSkillEvidence("u1", "reading", 0.2);
  await recordSkillEvidence("u1", "vocabulary", 0.2);
  await recordSkillEvidence("u1", "vocabulary", 0.2);

  const rec = await recommendLevelChange("u1");
  assert.equal(rec.suggestion, "down");
  assert.equal(rec.currentLevel, "B1");
  assert.equal(rec.targetLevel, "A2");
  assert.ok(rec.reasons.some((r) => /confidence/i.test(r)));
});

test("recommendLevelChange asks the user to onboard when there is no profile", async () => {
  const { recommendLevelChange } = await import("@/lib/learning/skill-mastery");
  profileRow = null;
  const rec = await recommendLevelChange("u1");
  assert.equal(rec.suggestion, "hold");
  assert.match(rec.reasons[0], /onboarding/i);
});

test("recommendLevelChange never recommends past the top of the CEFR scale", async () => {
  const { recordSkillEvidence, recommendLevelChange } = await import("@/lib/learning/skill-mastery");
  profileRow = { userId: "u1", englishLevel: "C2", completedAt: new Date() };
  await recordSkillEvidence("u1", "reading", 0.95);
  await recordSkillEvidence("u1", "reading", 0.95);
  await recordSkillEvidence("u1", "comprehension", 0.95);
  await recordSkillEvidence("u1", "comprehension", 0.95);
  const rec = await recommendLevelChange("u1");
  assert.notEqual(rec.suggestion, "up");
  assert.equal(rec.targetLevel, null);
});
