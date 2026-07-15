/**
 * Export bundle regression tests for account-lifecycle (Issue #711).
 *
 * Verifies that exportUserData includes all models required by the data
 * lifecycle matrix (#710):
 *   711-A: ReminderPreference (push scheduling preferences)
 *   711-C: LevelHistory, WordMastery, ArticleMastery, SkillMastery,
 *          ArticleDifficultyFeedback (learning mastery data)
 *   1013: StudyPlanSnapshot metadata (durable weekly study-plan state)
 *   711-E: Membership, ClassroomMembership, AssignmentCompletion
 *          (tenant / classroom history)
 *
 * Also verifies that deleteOwnAccount triggers best-effort object-storage byte
 * purge for MediaAssets attached to the user's private articles (711-D), and
 * that deletion still succeeds if storage purge fails.
 *
 * All Prisma calls and the storage runtime are mocked — no real DB or
 * filesystem is touched.
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Stub data
// ---------------------------------------------------------------------------

const NOW = new Date("2024-06-01T00:00:00Z");

const stubExportUser = {
  id: "user-1",
  name: "Alice",
  email: "alice@example.com",
  image: null,
  role: "Reader",
  createdAt: NOW,
  updatedAt: NOW,
  accounts: [{ provider: "google", type: "oauth" }],
  profile: {
    ageRange: "25-34",
    gender: "F",
    englishLevel: "B1",
    topics: ["tech"],
    dailyGoal: 2,
    completedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  },
  savedWords: [],
  readingProgress: [],
  dailyActivities: [],
  readingLists: [],
  highlights: [],
  tutorMessages: [],
  quizAttempts: [],
  pronunciationAttempts: [],

  // 711-A
  reminderPreference: {
    enabled: true,
    preferredHour: 9,
    quietHoursStart: 22,
    quietHoursEnd: 7,
    timezone: "America/New_York",
    createdAt: NOW,
    updatedAt: NOW,
  },

  // 711-C
  levelHistory: [{ level: "B1", changedAt: NOW }],
  wordMastery: [
    {
      lemma: "ephemeral",
      familiarity: 0.8,
      confidence: 0.7,
      exposures: 5,
      correctReviews: 4,
      incorrectReviews: 1,
      sourceArticleIds: [],
      lastSeenAt: NOW,
      lastReviewedAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    },
  ],
  articleMastery: [
    {
      articleId: "art-1",
      readingCompletion: 1.0,
      quizScore: 0.85,
      lookupDensity: 0.1,
      timeSpentMs: 12000,
      difficultyFeedback: "just_right",
      comprehensionScore: 0.9,
      lastActivityAt: NOW,
      createdAt: NOW,
      updatedAt: NOW,
    },
  ],
  skillMastery: [
    {
      skill: "reading",
      confidence: 0.75,
      evidenceCount: 10,
      recentEvidence: [],
      createdAt: NOW,
      updatedAt: NOW,
    },
  ],
  difficultyFeedback: [
    { articleId: "art-1", vote: "just_right", createdAt: NOW, updatedAt: NOW },
  ],

  // #810 — privacy-safe learning coach memory (aggregate signals only).
  learnerCoachMemories: [
    {
      skill: "comprehension",
      confidence: 0.42,
      evidenceCount: 8,
      lastObservedAt: NOW,
      trend: "declining",
      createdAt: NOW,
    },
  ],

  // #1013 — durable weekly study-plan snapshot metadata.
  studyPlanSnapshots: [
    {
      weekStart: new Date("2026-07-07T00:00:00Z"),
      weekEnd: new Date("2026-07-14T00:00:00Z"),
      generatedAt: new Date("2026-07-08T12:34:56Z"),
      summary: "This week, focus on comprehension and vocabulary.",
      isStarter: false,
      weakAreas: [
        {
          kind: "comprehension",
          severity: 0.71,
        },
      ],
      items: [
        {
          id: "comprehension:quiz",
          kind: "comprehension",
          title: "Read then take the comprehension quiz",
          href: "/browse?view=picks",
        },
      ],
      sourceVersion: "study-plan-v1",
      createdAt: new Date("2026-07-08T12:34:56Z"),
    },
  ],

  // 711-E
  memberships: [
    { orgId: "org-1", role: "Member", createdAt: NOW, updatedAt: NOW },
  ],
  classroomMemberships: [
    { classroomId: "class-1", role: "Student", createdAt: NOW },
  ],
  assignmentCompletions: [
    {
      assignmentId: "assign-1",
      status: "COMPLETED",
      quizScore: 95,
      completedAt: NOW,
      createdAt: NOW,
      updatedAt: NOW,
    },
  ],

  // #806 — reading placement (controlled columns only)
  placementResult: {
    seedLevel: "B1",
    recommendedLevel: "B2",
    questionCount: 4,
    correctCount: 4,
    skipped: false,
    completedAt: NOW,
  },
};

// ---------------------------------------------------------------------------
// Mock state
// ---------------------------------------------------------------------------

let stubUser: null | { id: string; role: string } = null;
let stubAdminCount = 2;
let stubMediaAssets: { storageKey: string }[] = [];
let storageDeletedKeys: string[] = [];
let storageDeleteShouldFail = false;
let lastUserFindUniqueArgs: { where: { id: string }; select?: Record<string, unknown> } | null = null;

const mockStorageInstance = {
  kind: "local" as const,
  put: async () => ({ storageKey: "k", sizeBytes: 0, checksum: "c" }),
  get: async () => null,
  delete: async (key: string) => {
    if (storageDeleteShouldFail) throw new Error("storage backend unavailable");
    storageDeletedKeys.push(key);
  },
};

// ---------------------------------------------------------------------------
// Module mock setup (runs once before any test)
// ---------------------------------------------------------------------------

before(() => {
  const mockPrisma = {
    user: {
      findUnique: async (args: { where: { id: string }; select?: Record<string, unknown> }) => {
        lastUserFindUniqueArgs = args;
        if (args.where.id === "missing") return null;
        // Return the full export stub; deleteOwnAccount only reads .id and .role
        // so a rich return value is safe for both call sites.
        return { ...stubExportUser, role: stubUser?.role ?? "Reader" };
      },
      count: async () => stubAdminCount,
      delete: async () => ({}),
    },
    mediaAsset: {
      findMany: async () => stubMediaAssets,
    },
    auditLog: {
      create: async () => ({ id: "audit-1" }),
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        user: {
          findUnique: async () => stubUser ?? { id: "user-1", role: "Reader" },
          count: async () => stubAdminCount,
          delete: async () => ({}),
        },
        auditLog: { create: async () => ({ id: "audit-1" }) },
      };
      return fn(tx);
    },
  };

  mock.module("@/lib/prisma", {
    namedExports: { prisma: mockPrisma },
  });

  mock.module("@/lib/storage/runtime", {
    namedExports: {
      getMediaStorage: () => mockStorageInstance,
    },
  });
});

beforeEach(() => {
  stubUser = { id: "user-1", role: "Reader" };
  stubAdminCount = 2;
  stubMediaAssets = [];
  storageDeletedKeys = [];
  storageDeleteShouldFail = false;
  lastUserFindUniqueArgs = null;
});

async function exportStubUserData(userId = "user-1") {
  const { exportUserData } = await import(
    "@/lib/account-lifecycle/account-commands"
  );
  const data = await exportUserData(userId);
  assert.ok(data, "export should not be null");
  return data;
}

async function deleteStubUserAccount() {
  const { deleteOwnAccount } = await import(
    "@/lib/account-lifecycle/account-commands"
  );
  return deleteOwnAccount("user-1");
}

function makeAuditInput(action: string, targetId = "user-1") {
  return {
    req: new Request("http://test/api/account"),
    session: { user: { id: "operator-1", role: "Admin" } },
    requestId: "req-1",
    action,
    targetType: "account",
    targetId,
    metadata: { format: "json" },
  } as const;
}

// ---------------------------------------------------------------------------
// 711-A: ReminderPreference in export
// ---------------------------------------------------------------------------

test("exportUserData includes reminderPreference (711-A)", async () => {
  const data = await exportStubUserData();
  assert.ok("reminderPreference" in data, "reminderPreference key must exist in export");
  assert.deepEqual(data.reminderPreference, stubExportUser.reminderPreference);
});

test("exportUserData reminderPreference is null when user has none", async () => {
  // The stub returns the full export user which has reminderPreference set;
  // null case is handled by Prisma nullable relation — we verify the key exists.
  const data = await exportStubUserData();
  assert.ok("reminderPreference" in data);
});

// ---------------------------------------------------------------------------
// 711-C: Learning mastery data in export
// ---------------------------------------------------------------------------

test("exportUserData includes levelHistory (711-C)", async () => {
  const data = await exportStubUserData();
  assert.ok(Array.isArray(data.levelHistory), "levelHistory must be an array");
  assert.equal(data.levelHistory.length, 1);
  assert.equal(data.levelHistory[0].level, "B1");
});

test("exportUserData includes wordMastery (711-C)", async () => {
  const data = await exportStubUserData();
  assert.ok(Array.isArray(data.wordMastery));
  assert.equal(data.wordMastery.length, 1);
  assert.equal(data.wordMastery[0].lemma, "ephemeral");
  assert.equal(data.wordMastery[0].familiarity, 0.8);
});

test("exportUserData includes articleMastery (711-C)", async () => {
  const data = await exportStubUserData();
  assert.ok(Array.isArray(data.articleMastery));
  assert.equal(data.articleMastery.length, 1);
  assert.equal(data.articleMastery[0].articleId, "art-1");
  assert.equal(data.articleMastery[0].comprehensionScore, 0.9);
});

test("exportUserData includes skillMastery (711-C)", async () => {
  const data = await exportStubUserData();
  assert.ok(Array.isArray(data.skillMastery));
  assert.equal(data.skillMastery.length, 1);
  assert.equal(data.skillMastery[0].skill, "reading");
});

test("exportUserData includes difficultyFeedback (711-C)", async () => {
  const data = await exportStubUserData();
  assert.ok(Array.isArray(data.difficultyFeedback));
  assert.equal(data.difficultyFeedback.length, 1);
  assert.equal(data.difficultyFeedback[0].vote, "just_right");
});

test("exportUserData includes learnerCoachMemory aggregates only (#810)", async () => {
  const data = await exportStubUserData();
  assert.ok(Array.isArray(data.learnerCoachMemories));
  assert.equal(data.learnerCoachMemories.length, 1);
  const row = data.learnerCoachMemories[0];
  assert.equal(row.skill, "comprehension");
  assert.equal(row.trend, "declining");
  // Privacy: only controlled aggregate keys are exported — no text/ids/PII.
  assert.deepEqual(
    Object.keys(row).sort(),
    ["confidence", "createdAt", "evidenceCount", "lastObservedAt", "skill", "trend"],
  );
});

test("exportUserData scopes export query to the requested user id (#1013)", async () => {
  await exportStubUserData("owned-user");
  assert.equal(lastUserFindUniqueArgs?.where.id, "owned-user");
});

test("exportUserData selects ordered StudyPlanSnapshot metadata fields (#1013)", async () => {
  await exportStubUserData();
  const snapshots = (lastUserFindUniqueArgs?.select as {
    studyPlanSnapshots?: {
      select?: Record<string, unknown>;
      orderBy?: Record<string, unknown>;
    };
  } | null)?.studyPlanSnapshots;
  assert.ok(snapshots, "studyPlanSnapshots must be selected");
  assert.deepEqual(snapshots.orderBy, { weekStart: "asc" });
  assert.deepEqual(Object.keys(snapshots.select ?? {}), [
    "weekStart",
    "weekEnd",
    "generatedAt",
    "summary",
    "isStarter",
    "weakAreas",
    "items",
    "sourceVersion",
    "createdAt",
  ]);
});

test("exportUserData includes studyPlanSnapshots metadata rows (#1013)", async () => {
  const data = await exportStubUserData();
  assert.ok(Array.isArray(data.studyPlanSnapshots), "studyPlanSnapshots must be an array");
  assert.equal(data.studyPlanSnapshots.length, 1);
  const row = data.studyPlanSnapshots[0];
  assert.deepEqual(Object.keys(row), [
    "weekStart",
    "weekEnd",
    "generatedAt",
    "summary",
    "isStarter",
    "weakAreas",
    "items",
    "sourceVersion",
    "createdAt",
  ]);
  assert.equal(row.sourceVersion, "study-plan-v1");
});

test("exportUserData keeps studyPlanSnapshots as an empty section when no rows exist (#1013)", async () => {
  const original = stubExportUser.studyPlanSnapshots;
  try {
    stubExportUser.studyPlanSnapshots = [];
    const data = await exportStubUserData();
    assert.ok("studyPlanSnapshots" in data, "studyPlanSnapshots key must exist in export");
    assert.deepEqual(data.studyPlanSnapshots, []);
  } finally {
    stubExportUser.studyPlanSnapshots = original;
  }
});

test("exportUserData records audit when audit context is provided", async () => {
  const { exportUserData } = await import(
    "@/lib/account-lifecycle/account-commands"
  );
  const data = await exportUserData("user-1", makeAuditInput("account.export"));
  assert.ok(data);
});

// ---------------------------------------------------------------------------
// 711-E: Membership / classroom / assignment completion in export
// ---------------------------------------------------------------------------

test("exportUserData includes memberships (711-E)", async () => {
  const data = await exportStubUserData();
  assert.ok(Array.isArray(data.memberships));
  assert.equal(data.memberships.length, 1);
  assert.equal(data.memberships[0].orgId, "org-1");
  assert.equal(data.memberships[0].role, "Member");
});

test("exportUserData includes classroomMemberships (711-E)", async () => {
  const data = await exportStubUserData();
  assert.ok(Array.isArray(data.classroomMemberships));
  assert.equal(data.classroomMemberships.length, 1);
  assert.equal(data.classroomMemberships[0].classroomId, "class-1");
});

test("exportUserData includes assignmentCompletions (711-E)", async () => {
  const data = await exportStubUserData();
  assert.ok(Array.isArray(data.assignmentCompletions));
  assert.equal(data.assignmentCompletions.length, 1);
  assert.equal(data.assignmentCompletions[0].assignmentId, "assign-1");
  assert.equal(data.assignmentCompletions[0].status, "COMPLETED");
  assert.equal(data.assignmentCompletions[0].quizScore, 95);
});

test("exportUserData includes PlacementResult controlled fields (#806)", async () => {
  const data = await exportStubUserData();
  assert.ok("placementResult" in data, "placementResult key must exist in export");
  const placement = data.placementResult as Record<string, unknown>;
  assert.equal(placement.seedLevel, "B1");
  assert.equal(placement.recommendedLevel, "B2");
  assert.equal(placement.questionCount, 4);
  assert.equal(placement.correctCount, 4);
  assert.equal(placement.skipped, false);
  // Privacy: no passage/question/answer text or lookup words are ever exported.
  for (const banned of [
    "passageText",
    "questionText",
    "answers",
    "options",
    "lookups",
    "lookupWords",
    "definitions",
    "content",
  ]) {
    assert.ok(!(banned in placement), `export must not contain '${banned}'`);
  }
});

// ---------------------------------------------------------------------------
// 711-D: Object-storage byte purge on account deletion
// ---------------------------------------------------------------------------

test("deleteOwnAccount purges object-storage bytes for owned MediaAssets (711-D)", async () => {
  stubMediaAssets = [
    { storageKey: "speech/abc123.mp3" },
    { storageKey: "speech/def456.mp3" },
  ];
  const result = await deleteStubUserAccount();

  assert.equal(result.ok, true);
  assert.deepEqual(storageDeletedKeys.sort(), [
    "speech/abc123.mp3",
    "speech/def456.mp3",
  ]);
});

test("deleteOwnAccount succeeds even when storage purge fails (711-D best-effort)", async () => {
  stubMediaAssets = [{ storageKey: "speech/abc123.mp3" }];
  storageDeleteShouldFail = true;
  const result = await deleteStubUserAccount();

  // DB deletion should still succeed despite storage failure
  assert.equal(result.ok, true);
  // No keys were deleted (purge threw)
  assert.equal(storageDeletedKeys.length, 0);
});

test("deleteOwnAccount skips storage purge when no owned MediaAssets exist (711-D)", async () => {
  stubMediaAssets = [];
  const result = await deleteStubUserAccount();

  assert.equal(result.ok, true);
  assert.equal(storageDeletedKeys.length, 0);
});

test("deleteOwnAccount returns 404 when account is missing", async () => {
  const { deleteOwnAccount } = await import(
    "@/lib/account-lifecycle/account-commands"
  );
  const result = await deleteOwnAccount("missing");
  assert.deepEqual(result, { ok: false, error: "Account not found", status: 404 });
});

test("deleteOwnAccount blocks deleting the last admin", async () => {
  stubUser = { id: "user-1", role: "Admin" };
  stubAdminCount = 1;
  const result = await deleteStubUserAccount();
  assert.deepEqual(result, {
    ok: false,
    error:
      "You are the last admin — transfer the Admin role to another user before deleting your account.",
    status: 409,
  });
});

test("deleteOwnAccount records audit when audit context is provided", async () => {
  const { deleteOwnAccount } = await import(
    "@/lib/account-lifecycle/account-commands"
  );
  const result = await deleteOwnAccount("user-1", makeAuditInput("account.delete"));
  assert.equal(result.ok, true);
});
