/** Orchestration-only refusal and recovery coverage for force-rescrape. */
process.env.LOG_LEVEL = "error";

import assert from "node:assert/strict";
import { before, beforeEach, mock, test } from "node:test";

import { ArticleVisibility } from "@prisma/client";
import type {
  ForceRescrapeRunnerDeps,
  PreparedRescrape,
} from "@/lib/scraper/incremental/force-rescrape-runner";

const NOW = new Date("2026-07-31T15:00:00.000Z");
const articleRow = {
  id: "article-runner-branches",
  title: "Current title",
  content: "Current public article body.",
  excerpt: null,
  author: null,
  heroImage: null,
  source: "Example",
  category: "science",
  wordCount: 4,
  readingMinutes: 1,
  sourceUrl: "https://example.com/current",
  canonicalUrl: "https://example.com/current",
  publishedAt: new Date("2026-07-30T15:00:00.000Z"),
  visibility: ArticleVisibility.PUBLIC,
  takedownState: "active",
};

let annotationCount = 0;
let pendingResult: { ok: true; pendingVersionId: string; baselineVersionId: string | null } | { ok: false; reason: "conflict" };
let activationResult: { ok: true; supersededVersionId: string | null } | { ok: false; reason: string };
let activeVersion: Record<string, unknown> | null = null;
let regenerationError: unknown = null;
const pendingCalls: unknown[] = [];
const activationCalls: unknown[] = [];
const failureCalls: unknown[] = [];
const regenerationCalls: unknown[] = [];

before(() => {
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        article: { findUnique: async () => articleRow },
      },
    },
  });
  mock.module("@/lib/scraper/incremental/force-rescrape-query", {
    namedExports: {
      countArticleAnnotations: async () => annotationCount,
      getActiveVersion: async () => activeVersion,
    },
  });
  mock.module("@/lib/scraper/incremental/force-rescrape-commit", {
    namedExports: {
      createPendingRescrape: async (input: unknown) => {
        pendingCalls.push(input);
        return pendingResult;
      },
      activateRescrape: async (input: unknown) => {
        activationCalls.push(input);
        return activationResult;
      },
      recordRescrapeFailure: async (input: unknown) => {
        failureCalls.push(input);
        return { updated: true };
      },
    },
  });
  mock.module("@/lib/scraper/incremental/derived-regeneration", {
    namedExports: {
      requestDerivedRegeneration: async (input: unknown) => {
        regenerationCalls.push(input);
        if (regenerationError !== null) throw regenerationError;
        return { alreadyRequested: false };
      },
    },
  });
});

beforeEach(() => {
  annotationCount = 0;
  pendingResult = { ok: true, pendingVersionId: "version-pending", baselineVersionId: "version-active" };
  activationResult = { ok: true, supersededVersionId: "version-active" };
  activeVersion = null;
  regenerationError = null;
  pendingCalls.length = 0;
  activationCalls.length = 0;
  failureCalls.length = 0;
  regenerationCalls.length = 0;
});

const cleanPrepared: PreparedRescrape = {
  kind: "prepared",
  content: {
    title: "Replacement title",
    content: "Replacement public article body.",
    sourceUrl: "https://example.com/current",
    canonicalUrl: "https://example.com/current",
  },
  signals: { bodyPresent: true, canonical: "match", safety: "safe", quality: "pass" },
};

const input = {
  articleId: articleRow.id,
  reason: "publisher correction",
  requestedById: "operator-branches",
};

function deps(prepareDraft: NonNullable<ForceRescrapeRunnerDeps["prepareDraft"]>): ForceRescrapeRunnerDeps {
  return { now: () => NOW, prepareDraft };
}

test("dry-run returns a metadata-only annotation preview without taking a pending lock", async () => {
  const { requestForceRescrape } = await import("@/lib/scraper/incremental/force-rescrape-runner");
  annotationCount = 2;
  activeVersion = { id: "version-active", status: "ACTIVE" };

  const outcome = await requestForceRescrape(
    { ...input, dryRun: true },
    deps(async () => {
      throw new Error("dry-run must not fetch");
    }),
  );

  assert.equal(outcome.kind, "dry-run");
  if (outcome.kind === "dry-run") {
    assert.equal(outcome.preview.activeVersion, activeVersion);
    assert.equal(outcome.preview.annotationCount, 2);
    assert.equal(outcome.preview.wouldActivate, false);
    assert.equal(outcome.preview.blockedReason, "annotation-migration-required");
  }
  assert.equal(pendingCalls.length, 0);
});

test("activation guard loss records a controlled internal failure", async () => {
  const { requestForceRescrape } = await import("@/lib/scraper/incremental/force-rescrape-runner");
  activationResult = { ok: false, reason: "guard-lost" };

  const outcome = await requestForceRescrape(input, deps(async () => cleanPrepared));

  assert.deepEqual(outcome, {
    ok: true,
    kind: "failed",
    articleId: articleRow.id,
    versionId: "version-pending",
    reason: "internal_error",
  });
  assert.equal(activationCalls.length, 1);
  assert.equal(failureCalls.length, 1);
});

test("regeneration enqueue failure preserves the already-activated outcome", async () => {
  const { requestForceRescrape } = await import("@/lib/scraper/incremental/force-rescrape-runner");
  regenerationError = new Error("queue unavailable");

  const outcome = await requestForceRescrape(input, deps(async () => cleanPrepared));

  assert.deepEqual(outcome, {
    ok: true,
    kind: "activated",
    articleId: articleRow.id,
    versionId: "version-pending",
    supersededVersionId: "version-active",
  });
  assert.equal(regenerationCalls.length, 1);
  assert.equal(failureCalls.length, 0);
});

test("a thrown Error releases the pending lock as a controlled internal failure", async () => {
  const { requestForceRescrape } = await import("@/lib/scraper/incremental/force-rescrape-runner");

  const outcome = await requestForceRescrape(
    input,
    deps(async () => {
      throw new Error("private upstream response");
    }),
  );

  assert.deepEqual(outcome, {
    ok: true,
    kind: "failed",
    articleId: articleRow.id,
    versionId: "version-pending",
    reason: "internal_error",
  });
  assert.equal(failureCalls.length, 1);
});

test("a non-Error throw releases the pending lock and then propagates", async () => {
  const { requestForceRescrape } = await import("@/lib/scraper/incremental/force-rescrape-runner");
  const thrown = { category: "non-error-sentinel" };

  await assert.rejects(
    () => requestForceRescrape(input, deps(async () => Promise.reject(thrown))),
    (error) => error === thrown,
  );
  assert.equal(failureCalls.length, 1);
});
