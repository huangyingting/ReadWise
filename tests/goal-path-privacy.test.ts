/**
 * Privacy test for Goal Paths (#809).
 *
 * Verifies that selecting a goal path stores and emits ONLY the controlled
 * `goalPath` enum — never reading history, article titles/ids, prompts, or any
 * inferred-goal rationale. Drives `updateProfile` with a fully mocked prisma +
 * analytics writer and inspects exactly what is persisted and emitted.
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

let upsertData: Record<string, unknown> | null = null;
let existingProfile: Record<string, unknown> | null = null;
let emitted: Array<{ type: string; userId?: string; properties?: unknown }> = [];

before(() => {
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        profile: { findUnique: async () => existingProfile },
        $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
          fn({
            profile: {
              upsert: async (args: { update?: Record<string, unknown> }) => {
                upsertData = args.update ?? null;
                return {};
              },
            },
            levelHistory: { create: async () => ({}) },
          }),
      },
    },
  });

  mock.module("@/lib/profile/repository", {
    namedExports: { getProfile: async () => existingProfile },
  });

  mock.module("@/lib/analytics/events", {
    namedExports: {
      ANALYTICS_EVENT_TYPES: { goalPathSelected: "goal_path_selected" },
      recordEvent: async (input: { type: string; userId?: string; properties?: unknown }) => {
        emitted.push(input);
      },
    },
  });
});

beforeEach(() => {
  upsertData = null;
  existingProfile = null;
  emitted = [];
});

const baseInput = {
  ageRange: null,
  gender: null,
  englishLevel: "B1" as const,
  topics: ["business"],
};

test("goal_path_selected emits ONLY { goalPath } — no content", async () => {
  const { updateProfile } = await import("@/lib/profile/commands");
  await updateProfile("u1", { ...baseInput, goalPath: "business" });

  assert.equal(emitted.length, 1);
  const event = emitted[0];
  assert.equal(event.type, "goal_path_selected");
  // The payload must be EXACTLY { goalPath } — no titles, ids, history, or text.
  assert.deepEqual(event.properties, { goalPath: "business" });
});

test("only the controlled goalPath enum is persisted on the profile", async () => {
  const { updateProfile } = await import("@/lib/profile/commands");
  await updateProfile("u1", { ...baseInput, goalPath: "academic" });

  assert.equal(upsertData?.goalPath, "academic");
  // No inferred-goal or history-derived fields leak into the persisted shape.
  const keys = Object.keys(upsertData ?? {});
  for (const banned of ["goalRationale", "history", "inferredGoal", "articleTitles"]) {
    assert.equal(keys.includes(banned), false);
  }
});

test("no event is emitted when goalPath is unchanged", async () => {
  existingProfile = { englishLevel: "B1", goalPath: "business" };
  const { updateProfile } = await import("@/lib/profile/commands");
  await updateProfile("u1", { ...baseInput, goalPath: "business" });
  assert.equal(emitted.length, 0);
});

test("no event is emitted when goalPath is omitted entirely", async () => {
  const { updateProfile } = await import("@/lib/profile/commands");
  await updateProfile("u1", { ...baseInput });
  assert.equal(emitted.length, 0);
  assert.equal(Object.prototype.hasOwnProperty.call(upsertData ?? {}, "goalPath"), false);
});
