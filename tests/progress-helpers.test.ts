/**
 * Tests for src/lib/progress-helpers.ts — level history and current level
 * queries. Covers toLevelEntry serialization and Prisma query orchestration.
 */
import { test, describe, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Prisma mock
// ---------------------------------------------------------------------------

let levelHistoryRows: Array<{ level: string; changedAt: Date }> = [];
let profileResult: { englishLevel: string } | null = null;

before(() => {
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        levelHistory: {
          findMany: async () => levelHistoryRows,
        },
        profile: {
          findUnique: async () => profileResult,
        },
      },
    },
  });
});

let progressHelpers: typeof import("@/lib/progress-helpers");

beforeEach(async () => {
  levelHistoryRows = [];
  profileResult = null;
  progressHelpers = await import("@/lib/progress-helpers");
});

describe("getLevelHistory", () => {
  test("returns empty array when no history exists", async () => {
    const result = await progressHelpers.getLevelHistory("user-1");
    assert.deepEqual(result, []);
  });

  test("returns entries with level and ISO changedAt string", async () => {
    const date = new Date("2025-06-15T10:30:00Z");
    levelHistoryRows = [{ level: "B1", changedAt: date }];

    const result = await progressHelpers.getLevelHistory("user-1");
    assert.equal(result.length, 1);
    assert.equal(result[0].level, "B1");
    assert.equal(result[0].changedAt, "2025-06-15T10:30:00.000Z");
  });

  test("preserves ordering from database (oldest first)", async () => {
    levelHistoryRows = [
      { level: "A2", changedAt: new Date("2025-01-01") },
      { level: "B1", changedAt: new Date("2025-03-01") },
      { level: "B2", changedAt: new Date("2025-06-01") },
    ];

    const result = await progressHelpers.getLevelHistory("user-1");
    assert.deepEqual(
      result.map((e) => e.level),
      ["A2", "B1", "B2"],
    );
  });
});

describe("getCurrentLevel", () => {
  test("returns null when no profile exists", async () => {
    profileResult = null;
    const result = await progressHelpers.getCurrentLevel("user-1");
    assert.equal(result, null);
  });

  test("returns the englishLevel from user profile", async () => {
    profileResult = { englishLevel: "B2" };
    const result = await progressHelpers.getCurrentLevel("user-1");
    assert.equal(result, "B2");
  });
});
