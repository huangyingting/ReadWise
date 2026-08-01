/** Defensive concurrency/result-mapping coverage for final-identity persistence. */
process.env.LOG_LEVEL = "error";

import assert from "node:assert/strict";
import { before, beforeEach, mock, test } from "node:test";

import { CrawlCandidateStatus, Prisma } from "@prisma/client";

type Candidate = ReturnType<typeof candidate>;
type TxClient = ReturnType<typeof transactionClient>;

let outerCandidateRows: Array<Candidate | null> = [];
let outerSurvivor: { id: string } | null = null;
let transactionSteps: Array<TxClient | Error> = [];
let resolution: Record<string, unknown> = {};
let mergeDecisions: Array<Record<string, unknown>> = [];
let fingerprintDecision = { sameProviderIds: [] as string[], crossProviderIds: [] as string[] };

before(() => {
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        crawlCandidate: {
          findUnique: async () => outerCandidateRows.shift() ?? null,
          findFirst: async () => outerSurvivor,
        },
        $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
          const step = transactionSteps.shift();
          if (step instanceof Error) throw step;
          if (!step) throw new Error("missing transaction fixture");
          return fn(step);
        },
      },
    },
  });
  mock.module("@/lib/scraper/incremental/final-identity", {
    namedExports: {
      resolveFinalIdentity: () => resolution,
      selectMergeWinner: () =>
        mergeDecisions.shift() ?? { kind: "merge", winnerId: "candidate-final", loserIds: [] },
      decideFingerprintMatches: () => fingerprintDecision,
    },
  });
});

beforeEach(() => {
  outerCandidateRows = [];
  outerSurvivor = null;
  transactionSteps = [];
  resolution = { decision: "keep-own-provider", identity: { key: "v1:canonical-final" } };
  mergeDecisions = [];
  fingerprintDecision = { sameProviderIds: [], crossProviderIds: [] };
});

const NOW = new Date("2026-07-31T22:00:00.000Z");
const input = {
  candidateId: "candidate-final",
  owningProviderKey: "undark",
  finalUrl: "https://undark.org/2026/07/31/final-identity-branch/",
  canonicalUrl: "https://undark.org/2026/07/31/final-identity-branch/",
  now: NOW,
};

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    id: "candidate-final",
    providerKey: "undark",
    identityVersion: 1,
    provisionalKey: "v1:provisional-final",
    canonicalKey: null,
    status: CrawlCandidateStatus.DISCOVERED,
    observedInBaseline: false,
    articleId: null,
    firstObservedAt: new Date("2026-07-30T00:00:00.000Z"),
    createdAt: new Date("2026-07-30T00:00:00.000Z"),
    ...overrides,
  };
}

function transactionClient(options: {
  findUniqueRows?: Candidate[];
  holder?: Candidate | null;
  matches?: Candidate[];
  updateManyCounts?: number[];
} = {}) {
  const findUniqueRows = [...(options.findUniqueRows ?? [candidate()])];
  const updateManyCounts = [...(options.updateManyCounts ?? [])];
  return {
    crawlCandidate: {
      findUnique: async () => findUniqueRows.shift() ?? null,
      findFirst: async () => options.holder ?? null,
      findMany: async () => options.matches ?? [],
      updateMany: async () => ({ count: updateManyCounts.shift() ?? 1 }),
      update: async () => ({}),
    },
    canonicalConflict: {
      upsert: async () => ({ id: "conflict-final" }),
    },
    job: {
      updateMany: async () => ({ count: 1 }),
    },
    urlAlias: { updateMany: async () => ({ count: 1 }) },
    discoveryObservation: { updateMany: async () => ({ count: 1 }) },
  };
}

test("a missing candidate raises the typed not-found error", async () => {
  const { applyFinalIdentity, CandidateNotFoundError } =
    await import("@/lib/scraper/incremental/final-identity-commit");
  outerCandidateRows = [null];

  await assert.rejects(() => applyFinalIdentity(input), CandidateNotFoundError);
});

test("an already-terminal candidate is an outer no-op", async () => {
  const { applyFinalIdentity } = await import("@/lib/scraper/incremental/final-identity-commit");
  outerCandidateRows = [candidate({ status: CrawlCandidateStatus.REJECTED })];

  assert.deepEqual(await applyFinalIdentity(input), {
    action: "noop-terminal",
    candidateId: "candidate-final",
    status: CrawlCandidateStatus.REJECTED,
  });
});

test("a candidate that became known inside the merge transaction stays untouched", async () => {
  const { applyFinalIdentity } = await import("@/lib/scraper/incremental/final-identity-commit");
  outerCandidateRows = [candidate()];
  transactionSteps = [transactionClient({ findUniqueRows: [candidate({ articleId: "article-known" })] })];

  assert.deepEqual(await applyFinalIdentity(input), {
    action: "known-article-untouched",
    candidateId: "candidate-final",
  });
});

test("a candidate that became terminal inside the merge transaction maps to a no-op", async () => {
  const { applyFinalIdentity } = await import("@/lib/scraper/incremental/final-identity-commit");
  outerCandidateRows = [candidate()];
  transactionSteps = [
    transactionClient({ findUniqueRows: [candidate({ status: CrawlCandidateStatus.NEEDS_REVIEW })] }),
  ];

  assert.deepEqual(await applyFinalIdentity(input), {
    action: "noop-terminal",
    candidateId: "candidate-final",
    status: CrawlCandidateStatus.NEEDS_REVIEW,
  });
});

test("an already-held canonical slot returns an idempotent kept outcome", async () => {
  const { applyFinalIdentity } = await import("@/lib/scraper/incremental/final-identity-commit");
  const row = candidate({ canonicalKey: "v1:canonical-final" });
  outerCandidateRows = [row];
  transactionSteps = [transactionClient({ findUniqueRows: [row], holder: row })];

  assert.deepEqual(await applyFinalIdentity(input), {
    action: "kept",
    winnerId: "candidate-final",
    mergedLoserIds: [],
    jobsCancelled: 0,
  });
});

test("an unmergeable canonical collision is routed to review", async () => {
  const { applyFinalIdentity } = await import("@/lib/scraper/incremental/final-identity-commit");
  outerCandidateRows = [candidate()];
  mergeDecisions = [{ kind: "review", reason: "multiple-known-articles" }];
  transactionSteps = [
    transactionClient({
      holder: candidate({ id: "candidate-holder", articleId: "article-holder" }),
    }),
  ];

  assert.deepEqual(await applyFinalIdentity(input), {
    action: "routed-to-review",
    candidateId: "candidate-final",
    reason: "multiple-known-articles",
    conflictId: "conflict-final",
  });
});

test("a canonical P2002 race retries and converges on the new holder", async () => {
  const { applyFinalIdentity } = await import("@/lib/scraper/incremental/final-identity-commit");
  const unique = new Prisma.PrismaClientKnownRequestError("canonical occupied", {
    code: "P2002",
    clientVersion: "test",
    meta: { target: ["providerKey", "canonicalKey"] },
  });
  const row = candidate({ canonicalKey: "v1:canonical-final" });
  outerCandidateRows = [candidate()];
  transactionSteps = [unique, transactionClient({ findUniqueRows: [row], holder: row })];

  const outcome = await applyFinalIdentity(input);
  assert.equal(outcome.action, "kept");
});

test("a non-canonical P2002 is not mistaken for a convergence race", async () => {
  const { applyFinalIdentity } = await import("@/lib/scraper/incremental/final-identity-commit");
  const unique = new Prisma.PrismaClientKnownRequestError("other unique slot", {
    code: "P2002",
    clientVersion: "test",
    meta: { target: "sourceUrl" },
  });
  outerCandidateRows = [candidate()];
  transactionSteps = [unique];

  await assert.rejects(() => applyFinalIdentity(input), unique);
});

test("an unrelated merge transaction error propagates", async () => {
  const { applyFinalIdentity } = await import("@/lib/scraper/incremental/final-identity-commit");
  const error = new Error("database unavailable");
  outerCandidateRows = [candidate()];
  transactionSteps = [error];

  await assert.rejects(() => applyFinalIdentity(input), error);
});

test("a transfer guard race retries and converges after ownership moves", async () => {
  const { applyFinalIdentity } = await import("@/lib/scraper/incremental/final-identity-commit");
  resolution = {
    decision: "transfer-to-provider",
    targetProviderKey: "theconversation",
    identity: { key: "v1:canonical-final" },
  };
  const moved = candidate({ providerKey: "theconversation", canonicalKey: "v1:canonical-final" });
  outerCandidateRows = [candidate()];
  transactionSteps = [
    transactionClient({ updateManyCounts: [0] }),
    transactionClient({ findUniqueRows: [moved], holder: moved }),
  ];

  const outcome = await applyFinalIdentity(input);
  assert.equal(outcome.action, "transferred");
});

test("fingerprinting leaves a winner that became terminal untouched", async () => {
  const { applyFinalIdentity } = await import("@/lib/scraper/incremental/final-identity-commit");
  const row = candidate({ canonicalKey: "v1:canonical-final" });
  outerCandidateRows = [row];
  transactionSteps = [
    transactionClient({ findUniqueRows: [row], holder: row }),
    transactionClient({ findUniqueRows: [candidate({ status: CrawlCandidateStatus.REJECTED })] }),
  ];

  const outcome = await applyFinalIdentity({ ...input, prose: "A sufficiently distinctive article body for hashing." });
  assert.equal(outcome.action, "kept");
});

test("fingerprinting with no matches records the hash without merging", async () => {
  const { applyFinalIdentity } = await import("@/lib/scraper/incremental/final-identity-commit");
  const row = candidate({ canonicalKey: "v1:canonical-final" });
  outerCandidateRows = [row];
  transactionSteps = [
    transactionClient({ findUniqueRows: [row], holder: row }),
    transactionClient({ findUniqueRows: [row], matches: [] }),
  ];

  const outcome = await applyFinalIdentity({ ...input, prose: "A sufficiently distinctive article body for hashing." });
  assert.equal(outcome.action, "kept");
});

test("an unmergeable same-provider fingerprint collision is routed to review", async () => {
  const { applyFinalIdentity } = await import("@/lib/scraper/incremental/final-identity-commit");
  const row = candidate({ canonicalKey: "v1:canonical-final" });
  const other = candidate({ id: "candidate-fingerprint-other", articleId: "article-other" });
  outerCandidateRows = [row];
  fingerprintDecision = { sameProviderIds: [other.id], crossProviderIds: [] };
  mergeDecisions = [{ kind: "review", reason: "multiple-known-articles" }];
  transactionSteps = [
    transactionClient({ findUniqueRows: [row], holder: row }),
    transactionClient({ findUniqueRows: [row], matches: [other] }),
  ];

  assert.deepEqual(
    await applyFinalIdentity({ ...input, prose: "A sufficiently distinctive article body for hashing." }),
    {
      action: "routed-to-review",
      candidateId: "candidate-final",
      reason: "cross-provider-prose-fingerprint",
      conflictId: "conflict-final",
    },
  );
});

test("a route-to-review candidate that became known inside the transaction stays untouched", async () => {
  const { applyFinalIdentity } = await import("@/lib/scraper/incremental/final-identity-commit");
  resolution = {
    decision: "route-to-review",
    reason: "unknown-cross-domain-canonical",
    identity: null,
    targetProviderKey: null,
  };
  outerCandidateRows = [candidate()];
  transactionSteps = [
    transactionClient({ findUniqueRows: [candidate({ observedInBaseline: true })] }),
  ];

  assert.deepEqual(await applyFinalIdentity(input), {
    action: "known-article-untouched",
    candidateId: "candidate-final",
  });
});
