/**
 * Unit tests for src/lib/processing-state.ts (RW-016).
 *
 * Verifies the step-state writers (begin/finish/reset) upsert the expected rows,
 * that statuses map correctly (running / generated / skipped / fallback / failed),
 * that `lastError` is only persisted for `failed`, and that the writers are
 * best-effort (a Prisma failure never throws). All Prisma calls are mocked.
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

type UpsertArgs = {
  where: { articleId_step: { articleId: string; step: string } };
  create: Record<string, unknown>;
  update: Record<string, unknown>;
};

let upsertArgs: UpsertArgs | null = null;
let deleteManyArgs: { where: Record<string, unknown> } | null = null;
let findManyResult: unknown[] = [];
let upsertImpl: (args: UpsertArgs) => Promise<unknown> = async (args) => {
  upsertArgs = args;
  return { id: "step-1" };
};

before(() => {
  const mockPrisma = {
    articleProcessingStep: {
      upsert: (args: UpsertArgs) => upsertImpl(args),
      findMany: async () => findManyResult,
      deleteMany: async (args: { where: Record<string, unknown> }) => {
        deleteManyArgs = args;
        return { count: 3 };
      },
    },
  };
  mock.module("@/lib/prisma", { namedExports: { prisma: mockPrisma } });
});

beforeEach(() => {
  upsertArgs = null;
  deleteManyArgs = null;
  findManyResult = [];
  upsertImpl = async (args) => {
    upsertArgs = args;
    return { id: "step-1" };
  };
});

function lastUpsertArgs(): UpsertArgs {
  assert.ok(upsertArgs);
  return upsertArgs;
}

test("beginStep marks the step running and increments attempts", async () => {
  const { beginStep } = await import("@/lib/processing/state");
  await beginStep("article-1", "tags");

  const args = lastUpsertArgs();
  assert.deepEqual(args.where.articleId_step, {
    articleId: "article-1",
    step: "tags",
  });
  assert.equal(args.create.status, "running");
  assert.equal(args.create.attempts, 1);
  assert.equal(args.update.status, "running");
  assert.deepEqual(args.update.attempts, { increment: 1 });
  assert.equal(args.update.completedAt, null);
  assert.equal(args.update.fallbackReason, null);
  assert.equal(args.update.lastError, null);
});

test("finishStep records a generated step with the model name and no error", async () => {
  const { finishStep } = await import("@/lib/processing/state");
  await finishStep("article-1", "quiz", "generated", { modelName: "gpt-test" });

  const args = lastUpsertArgs();
  assert.equal(args.update.status, "generated");
  assert.equal(args.update.modelName, "gpt-test");
  assert.equal(args.update.lastError, null);
  assert.notEqual(args.update.completedAt, null);
  assert.equal(args.update.fallbackReason, null);
});

test("finishStep fallback persists a safe fallback reason", async () => {
  const { finishStep } = await import("@/lib/processing/state");
  await finishStep("article-1", "quiz", "fallback", { fallbackReason: "validation_failed" });

  const args = lastUpsertArgs();
  assert.equal(args.update.status, "fallback");
  assert.equal(args.update.fallbackReason, "validation_failed");
});

test("finishStep skipped creates a row with zero attempts", async () => {
  const { finishStep } = await import("@/lib/processing/state");
  await finishStep("article-1", "speech", "skipped");

  const args = lastUpsertArgs();
  assert.equal(args.create.status, "skipped");
  assert.equal(args.create.attempts, 0);
  assert.equal(args.update.status, "skipped");
});

test("finishStep failed persists the (clamped) error message", async () => {
  const { finishStep } = await import("@/lib/processing/state");
  await finishStep("article-1", "vocabulary", "failed", { lastError: "boom" });

  const args = lastUpsertArgs();
  assert.equal(args.update.status, "failed");
  assert.equal(args.update.lastError, "boom");
});

test("finishStep only stores lastError for failed steps", async () => {
  const { finishStep } = await import("@/lib/processing/state");
  await finishStep("article-1", "tags", "fallback", { lastError: "ignored" });

  const args = lastUpsertArgs();
  assert.equal(args.update.status, "fallback");
  assert.equal(args.update.lastError, null);
});

test("beginStep is best-effort: a Prisma failure does not throw", async () => {
  upsertImpl = async () => {
    throw new Error("db down");
  };
  const { beginStep } = await import("@/lib/processing/state");
  await assert.doesNotReject(() => beginStep("article-1", "tags"));
});

test("getArticleProcessingSteps returns the stored rows", async () => {
  findManyResult = [{ id: "s1", step: "tags", status: "generated" }];
  const { getArticleProcessingSteps } = await import("@/lib/processing/state");
  const rows = await getArticleProcessingSteps("article-1");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].step, "tags");
});

test("resetProcessingSteps clears only the requested steps", async () => {
  const { resetProcessingSteps } = await import("@/lib/processing/state");
  const count = await resetProcessingSteps("article-1", ["tags", "quiz"]);
  assert.equal(count, 3);
  assert.deepEqual(deleteManyArgs!.where, {
    articleId: "article-1",
    step: { in: ["tags", "quiz"] },
  });
});

test("resetProcessingSteps without steps clears the whole article", async () => {
  const { resetProcessingSteps } = await import("@/lib/processing/state");
  await resetProcessingSteps("article-1");
  assert.deepEqual(deleteManyArgs!.where, { articleId: "article-1" });
});

test("translationStepKey scopes the step to a language", async () => {
  const { translationStepKey } = await import("@/lib/processing/state");
  assert.equal(translationStepKey("es"), "translation:es");
});
