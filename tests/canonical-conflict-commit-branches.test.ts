process.env.LOG_LEVEL = "error";

import assert from "node:assert/strict";
import {
  CanonicalConflictStatus,
  Prisma,
} from "@prisma/client";
import { before, beforeEach, mock, test } from "node:test";

const openConflict = {
  id: "conflict-1",
  providerKey: "provider-1",
  identityVersion: 1,
  canonicalKey: "v1:canonical",
  challengerKey: "v1:challenger",
  incumbentCandidateId: null,
  status: CanonicalConflictStatus.OPEN,
};

type ConflictRead = Omit<typeof openConflict, "status"> & {
  status: CanonicalConflictStatus;
};

let conflictReads: ConflictRead[] = [];
let transactionMode: "unique" | "race" | "success" = "success";
let transactionCalls = 0;
let candidateUpdateIds: string[] = [];
let challengerUpdateIds: string[] = [];

const uniqueError = new Prisma.PrismaClientKnownRequestError("canonical slot occupied", {
  code: "P2002",
  clientVersion: "test",
  meta: { target: ["providerKey", "canonicalKey"] },
});

function transactionClient() {
  return {
    canonicalConflict: {
      updateMany: async () => ({ count: transactionMode === "race" ? 0 : 1 }),
    },
    article: {
      findUnique: async () => ({ id: "article-1" }),
    },
    crawlCandidate: {
      findFirst: async (args: { where: { OR?: unknown } }) =>
        args.where.OR ? { id: "existing-survivor" } : { id: "challenger-1" },
      update: async ({ where }: { where: { id: string } }) => {
        candidateUpdateIds.push(where.id);
        return { id: where.id };
      },
      updateMany: async ({ where }: { where: { id: string } }) => {
        challengerUpdateIds.push(where.id);
        return { count: 1 };
      },
    },
    urlAlias: {
      upsert: async () => ({ id: "alias-1" }),
    },
  };
}

before(() => {
  mock.module("@/lib/scraper/incremental/canonical-conflict-query", {
    namedExports: {
      resolveConflictParticipants: async () => ["article-1"],
    },
  });
  mock.module("@/lib/scraper/incremental/canonical-conflict-migrate", {
    namedExports: {
      migrateReaderDataInTx: async () => ({}),
    },
  });
  mock.module("@/lib/scraper/incremental/final-identity-commit", {
    namedExports: {
      foldLoserInTx: async () => {},
    },
  });
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        canonicalConflict: {
          findUnique: async () => conflictReads.shift() ?? null,
        },
        $transaction: async (callback: (tx: unknown) => Promise<unknown>) => {
          transactionCalls += 1;
          if (transactionMode === "unique") throw uniqueError;
          return callback(transactionClient());
        },
      },
    },
  });
});

beforeEach(() => {
  conflictReads = [{ ...openConflict }];
  transactionMode = "success";
  transactionCalls = 0;
  candidateUpdateIds = [];
  challengerUpdateIds = [];
});

async function resolveConflict() {
  const { resolveCanonicalConflict } = await import(
    "@/lib/scraper/incremental/canonical-conflict-commit"
  );
  return resolveCanonicalConflict({
    conflictId: "conflict-1",
    survivingArticleId: "article-1",
    resolvedBy: "operator-1",
    now: new Date("2026-07-31T00:00:00.000Z"),
  });
}

test("canonical conflict resolution bounds retries on canonical-slot uniqueness races", async () => {
  transactionMode = "unique";

  await assert.rejects(resolveConflict(), (error: unknown) => error === uniqueError);
  assert.equal(transactionCalls, 6);
});

test("canonical conflict resolution maps a guarded race to dismissed-noop or stale", async () => {
  transactionMode = "race";
  conflictReads.push({ ...openConflict, status: CanonicalConflictStatus.DISMISSED });
  assert.deepEqual(await resolveConflict(), {
    ok: true,
    kind: "noop",
    conflictId: "conflict-1",
    reason: "already-dismissed",
    status: CanonicalConflictStatus.DISMISSED,
  });

  conflictReads = [
    { ...openConflict },
    { ...openConflict },
  ];
  assert.deepEqual(await resolveConflict(), {
    ok: false,
    reason: "stale",
    conflictId: "conflict-1",
    status: CanonicalConflictStatus.OPEN,
  });
});

test("canonical conflict resolution reuses the survivor candidate and folds a challenger", async () => {
  assert.deepEqual(await resolveConflict(), {
    ok: true,
    kind: "applied",
    conflictId: "conflict-1",
    survivingArticleId: "article-1",
    loserArticleIds: [],
    survivorCandidateId: "existing-survivor",
  });
  assert.deepEqual(candidateUpdateIds, ["existing-survivor"]);
  assert.deepEqual(challengerUpdateIds, ["challenger-1"]);
});
