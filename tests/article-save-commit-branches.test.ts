/** Defensive transaction and convergence coverage for incremental Article saves. */
process.env.LOG_LEVEL = "error";

import assert from "node:assert/strict";
import { before, beforeEach, mock, test } from "node:test";

import { CrawlCandidateStatus } from "@prisma/client";

type Candidate = ReturnType<typeof candidate>;
type TxClient = ReturnType<typeof transactionClient>;

let transactionSteps: Array<TxClient | Error> = [];
let outerCandidateRows: Array<Candidate | null> = [];
let existingArticle: { id: string } | null = null;
let outerLinkCounts: number[] = [];
const processJobs: string[] = [];

before(() => {
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        crawlCandidate: {
          findUnique: async () => outerCandidateRows.shift() ?? null,
          updateMany: async () => ({ count: outerLinkCounts.shift() ?? 1 }),
        },
        article: {
          findFirst: async () => existingArticle,
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
  mock.module("@/lib/jobs/enqueue", {
    namedExports: {
      enqueueArticleProcess: async (articleId: string) => {
        processJobs.push(articleId);
        return { id: `job-${articleId}` };
      },
      enqueueArticleProcessInTx: async (_tx: unknown, articleId: string) => {
        processJobs.push(articleId);
        return { id: `job-${articleId}` };
      },
      enqueueJobInTx: async () => ({ id: "unused-job" }),
    },
  });
});

beforeEach(() => {
  transactionSteps = [];
  outerCandidateRows = [];
  existingArticle = null;
  outerLinkCounts = [];
  processJobs.length = 0;
});

const NOW = new Date("2026-07-31T23:00:00.000Z");
const input = {
  candidateId: "candidate-save",
  expectedProviderKey: "provider-save",
  sourceGeneration: null,
  draft: {
    title: "Saved title",
    content: "A complete public article body for the save branch tests.",
    sourceUrl: "https://example.com/save-branch",
    canonicalUrl: "https://example.com/save-branch",
  },
  fingerprint: { version: 1, hash: "save-fingerprint" },
  now: NOW,
};

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    id: "candidate-save",
    providerKey: "provider-save",
    discoverySourceId: null,
    canonicalKey: "v1:canonical-save",
    status: CrawlCandidateStatus.DISCOVERED,
    observedInBaseline: false,
    articleId: null,
    ...overrides,
  };
}

function transactionClient(options: {
  candidateRow?: Candidate | null;
  linkedCount?: number;
  articleId?: string;
} = {}) {
  return {
    crawlCandidate: {
      findUnique: async () =>
        options.candidateRow === undefined ? candidate() : options.candidateRow,
      updateMany: async () => ({ count: options.linkedCount ?? 1 }),
    },
    discoverySource: {
      findUnique: async () => null,
    },
    article: {
      create: async () => ({ id: options.articleId ?? "article-created" }),
    },
  };
}

test("a missing candidate inside the save transaction raises the typed error", async () => {
  const { saveIncrementalArticle, SaveCandidateNotFoundError } =
    await import("@/lib/scraper/incremental/article-save-commit");
  transactionSteps = [transactionClient({ candidateRow: null })];

  await assert.rejects(() => saveIncrementalArticle(input), SaveCandidateNotFoundError);
});

test("a candidate that became terminal inside the transaction is an idempotent no-op", async () => {
  const { saveIncrementalArticle } = await import("@/lib/scraper/incremental/article-save-commit");
  transactionSteps = [
    transactionClient({ candidateRow: candidate({ status: CrawlCandidateStatus.REJECTED }) }),
  ];

  assert.deepEqual(await saveIncrementalArticle(input), {
    action: "noop-terminal",
    candidateId: "candidate-save",
    status: CrawlCandidateStatus.REJECTED,
  });
});

function losingTransaction(): TxClient {
  return transactionClient({ linkedCount: 0, articleId: "article-rolled-back" });
}

test("a lost save race whose candidate vanished converges to a safe known outcome", async () => {
  const { saveIncrementalArticle } = await import("@/lib/scraper/incremental/article-save-commit");
  transactionSteps = [losingTransaction()];
  outerCandidateRows = [null];

  assert.deepEqual(await saveIncrementalArticle(input), {
    action: "known-article-untouched",
    candidateId: "candidate-save",
  });
});

test("a lost save race never revives a baseline candidate", async () => {
  const { saveIncrementalArticle } = await import("@/lib/scraper/incremental/article-save-commit");
  transactionSteps = [losingTransaction()];
  outerCandidateRows = [candidate({ observedInBaseline: true })];

  assert.equal((await saveIncrementalArticle(input)).action, "known-article-untouched");
});

test("a lost save race converges directly on the candidate's winning Article", async () => {
  const { saveIncrementalArticle } = await import("@/lib/scraper/incremental/article-save-commit");
  transactionSteps = [losingTransaction()];
  outerCandidateRows = [candidate({ articleId: "article-winner" })];

  assert.deepEqual(await saveIncrementalArticle(input), {
    action: "converged",
    candidateId: "candidate-save",
    articleId: "article-winner",
  });
  assert.deepEqual(processJobs, ["article-winner"]);
});

test("a lost save race respects a newly-terminal candidate", async () => {
  const { saveIncrementalArticle } = await import("@/lib/scraper/incremental/article-save-commit");
  transactionSteps = [losingTransaction()];
  outerCandidateRows = [candidate({ status: CrawlCandidateStatus.NEEDS_REVIEW })];

  assert.deepEqual(await saveIncrementalArticle(input), {
    action: "noop-terminal",
    candidateId: "candidate-save",
    status: CrawlCandidateStatus.NEEDS_REVIEW,
  });
});

test("a race with no visible winner retries and completes on the next transaction", async () => {
  const { saveIncrementalArticle } = await import("@/lib/scraper/incremental/article-save-commit");
  transactionSteps = [losingTransaction(), transactionClient({ articleId: "article-retry" })];
  outerCandidateRows = [candidate()];
  existingArticle = null;

  assert.deepEqual(await saveIncrementalArticle(input), {
    action: "saved",
    candidateId: "candidate-save",
    articleId: "article-retry",
  });
});

test("a different candidate's existing Article is linked and its job is ensured", async () => {
  const { saveIncrementalArticle } = await import("@/lib/scraper/incremental/article-save-commit");
  transactionSteps = [losingTransaction()];
  outerCandidateRows = [candidate()];
  existingArticle = { id: "article-existing" };
  outerLinkCounts = [1];

  assert.deepEqual(await saveIncrementalArticle(input), {
    action: "converged",
    candidateId: "candidate-save",
    articleId: "article-existing",
  });
  assert.deepEqual(processJobs, ["article-existing"]);
});

test("a second link race re-reads and returns the candidate's actual Article", async () => {
  const { saveIncrementalArticle } = await import("@/lib/scraper/incremental/article-save-commit");
  transactionSteps = [losingTransaction()];
  outerCandidateRows = [candidate(), candidate({ articleId: "article-reread" })];
  existingArticle = { id: "article-existing" };
  outerLinkCounts = [0];

  assert.deepEqual(await saveIncrementalArticle(input), {
    action: "converged",
    candidateId: "candidate-save",
    articleId: "article-reread",
  });
});
