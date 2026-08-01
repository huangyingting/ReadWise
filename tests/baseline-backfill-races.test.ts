/** Deterministic unique-race and error propagation coverage for the baseline seed. */
process.env.LOG_LEVEL = "error";

import assert from "node:assert/strict";
import { before, beforeEach, mock, test } from "node:test";

import { Prisma } from "@prisma/client";
import type { BaselineArticleInput } from "@/lib/scraper/incremental/baseline-backfill";

type FailureMode =
  | "none"
  | "alias-p2002"
  | "candidate-p2002"
  | "conflict-p2002"
  | "alias-error"
  | "candidate-error"
  | "conflict-error";

let mode: FailureMode = "none";
let articleRows: BaselineArticleInput[] = [];
let candidateFindCalls = 0;
const genericError = new Error("simulated persistence failure");

function p2002(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "test",
  });
}

before(() => {
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        article: {
          findMany: async () => articleRows,
        },
        crawlCandidate: {
          findUnique: async () => {
            candidateFindCalls += 1;
            if (mode === "candidate-p2002" && candidateFindCalls === 2) {
              return { id: "candidate-created-by-racer" };
            }
            return null;
          },
          create: async () => {
            if (mode === "candidate-p2002") throw p2002();
            if (mode === "candidate-error") throw genericError;
            return { id: "candidate-created-locally" };
          },
        },
        urlAlias: {
          findUnique: async () => null,
          create: async () => {
            if (mode === "alias-p2002") throw p2002();
            if (mode === "alias-error") throw genericError;
            return { id: "alias-created-locally" };
          },
        },
        canonicalConflict: {
          findUnique: async () => null,
          create: async () => {
            if (mode === "conflict-p2002") throw p2002();
            if (mode === "conflict-error") throw genericError;
            return { id: "conflict-created-locally" };
          },
        },
      },
    },
  });
});

beforeEach(() => {
  mode = "none";
  candidateFindCalls = 0;
  articleRows = [article("article-branch-a")];
});

function article(id: string): BaselineArticleInput {
  return {
    id,
    sourceUrl: "https://undark.org/2026/07/31/baseline-race-branch-story/",
    publishedAt: new Date("2026-07-30T12:00:00.000Z"),
    createdAt: new Date("2026-07-31T12:00:00.000Z"),
  };
}

test("an alias-create unique race is reported as an existing alias", async () => {
  const { backfillDiscoveryBaseline } = await import("@/lib/scraper/incremental/baseline-backfill");
  mode = "alias-p2002";

  const report = await backfillDiscoveryBaseline();

  assert.equal(report.candidatesCreated, 1);
  assert.equal(report.aliasesCreated, 0);
  assert.equal(report.aliasesExisting, 1);
});

test("a candidate-create unique race re-reads the winner before seeding its alias", async () => {
  const { backfillDiscoveryBaseline } = await import("@/lib/scraper/incremental/baseline-backfill");
  mode = "candidate-p2002";

  const report = await backfillDiscoveryBaseline();

  assert.equal(candidateFindCalls, 2);
  assert.equal(report.candidatesCreated, 0);
  assert.equal(report.candidatesExisting, 1);
  assert.equal(report.aliasesCreated, 1);
});

test("a conflict-create unique race is reported as an existing conflict", async () => {
  const { backfillDiscoveryBaseline } = await import("@/lib/scraper/incremental/baseline-backfill");
  mode = "conflict-p2002";
  articleRows = [article("article-conflict-a"), article("article-conflict-b")];

  const report = await backfillDiscoveryBaseline();

  assert.equal(report.conflicts, 1);
  assert.equal(report.conflictsCreated, 0);
  assert.equal(report.conflictsExisting, 1);
});

for (const failure of ["alias-error", "candidate-error", "conflict-error"] as const) {
  test(`${failure} propagates instead of being mistaken for a unique race`, async () => {
    const { backfillDiscoveryBaseline } = await import("@/lib/scraper/incremental/baseline-backfill");
    mode = failure;
    if (failure === "conflict-error") {
      articleRows = [article("article-error-a"), article("article-error-b")];
    }

    await assert.rejects(() => backfillDiscoveryBaseline(), genericError);
  });
}
