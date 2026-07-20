/**
 * Historical-backfill persistence integration tests (#1101, Phase 3.2).
 *
 * Engine-agnostic like `candidate-review.test.ts`: runs on SQLite under `npm run
 * test:db`, PostgreSQL in CI, guarded by `enabled` (RUN_DB_INTEGRATION=1). They
 * exercise the REAL guarded backfill commit/query (`backfill-commit.ts` /
 * `backfill-query.ts`) against the live database and prove the #1101 guarantees:
 *
 *   - DRY-RUN preview counts the eligible buckets and creates NO run + NO Job +
 *     fetches no body (AC);
 *   - create persists actor / reason / requested vs effective bounds / warnings;
 *   - advance reactivates ONLY OBSERVED_BASELINE / OBSERVED_SHADOW identities
 *     (flip observedInBaseline→false + status QUEUED) and enqueues a LOW-priority
 *     (-100) candidate-ingest Job — governing invariant: an identity with (or
 *     that lost) an Article, out-of-window, or unknown-date is NEVER reactivated;
 *   - the item cap and checkpoint bound the run (budget-reached / drained), and a
 *     re-scan never double-reactivates (restart-safe, never widens the range);
 *   - pause blocks the advance, resume re-enables it, cancel is terminal;
 *   - a real-time ingest Job (priority 0) is claimed BEFORE a backfill Job (-100)
 *     under queue contention;
 *   - a sanitized backfill audit entry persists and is queryable.
 *
 * Backfill-run rows are NOT swept by the shared `dbit_` PREFIX cleanup, and
 * candidate-ingest Jobs carry the dedupe key `article-ingest:candidate:<id>:v<v>`
 * (also not PREFIX-swept), so this file deletes both in a local afterEach.
 */
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { BackfillRunStatus, CrawlCandidateStatus, JobType } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import {
  advanceBackfillRun,
  applyBackfillControl,
  cancelBackfillRun,
  createBackfillRun,
  pauseBackfillRun,
  resumeBackfillRun,
} from "@/lib/scraper/incremental/backfill-commit";
import {
  getBackfillRun,
  listRunnableBackfillRunIds,
  previewBackfill,
} from "@/lib/scraper/incremental/backfill-query";
import {
  BACKFILL_JOB_PRIORITY,
  resolveEffectiveBackfillBounds,
} from "@/lib/scraper/incremental/backfill-policy";
import {
  candidateIngestDedupeKey,
  CANDIDATE_INGEST_PROCESSING_VERSION,
  claimNextJob,
  enqueueCandidateIngestInTx,
} from "@/lib/jobs";
import { recordAuditLog, AUDIT_ACTIONS } from "@/lib/security/audit";

import { enabled } from "./support/db-config";
import { id, registerIntegrationCleanup } from "./support/db-helpers";
import { createCrawlCandidate, providerKey } from "./support/discovery-fixtures";

registerIntegrationCleanup();

const { BASELINE, DISCOVERED, QUEUED, SKIPPED_OUTSIDE_WINDOW } = CrawlCandidateStatus;

/** Effective bounds are always concrete; build them directly for deterministic scans. */
const WINDOW_START = new Date("2020-01-01T00:00:00.000Z");
const WINDOW_END = new Date("2020-12-31T00:00:00.000Z");
const IN_WINDOW = new Date("2020-06-01T00:00:00.000Z");
const OUT_OF_WINDOW = new Date("2019-01-01T00:00:00.000Z");

function bounds(maxItems = 100) {
  return { windowStart: WINDOW_START, windowEnd: WINDOW_END, maxItems };
}

/** candidate ids whose ingest Jobs must be swept (dedupe key is not PREFIX-scoped). */
const ingestCandidateIds = new Set<string>();
/** provider keys whose BackfillRun rows must be swept (not PREFIX-swept by cleanup). */
const runProviderKeys = new Set<string>();

async function makeRun(pk: string, over: { maxItems?: number } = {}): Promise<string> {
  runProviderKeys.add(pk);
  const { id: runId } = await createBackfillRun({
    providerKey: pk,
    actorId: id("actor"),
    reason: "gap remediation",
    requested: { windowStart: WINDOW_START, windowEnd: WINDOW_END, maxItems: over.maxItems ?? 100 },
    effective: bounds(over.maxItems ?? 100),
    warnings: [],
  });
  return runId;
}

async function ingestJobFor(candidateId: string) {
  ingestCandidateIds.add(candidateId);
  return prisma.job.findUnique({
    where: { dedupeKey: candidateIngestDedupeKey(candidateId, CANDIDATE_INGEST_PROCESSING_VERSION) },
  });
}

afterEach(async () => {
  if (!enabled) return;
  const dedupeKeys = [...ingestCandidateIds].map((cid) =>
    candidateIngestDedupeKey(cid, CANDIDATE_INGEST_PROCESSING_VERSION),
  );
  if (dedupeKeys.length > 0) {
    await prisma.job.deleteMany({ where: { dedupeKey: { in: dedupeKeys } } });
  }
  if (runProviderKeys.size > 0) {
    await prisma.backfillRun.deleteMany({ where: { providerKey: { in: [...runProviderKeys] } } });
  }
  ingestCandidateIds.clear();
  runProviderKeys.clear();
});

// ---------------------------------------------------------------------------
// Dry-run preview: counts only, no run, no Job.
// ---------------------------------------------------------------------------

test("dry-run preview counts eligible buckets and creates NO run or Job", { skip: !enabled }, async () => {
  const pk = providerKey("bf");
  // eligible: OBSERVED_BASELINE + OBSERVED_SHADOW + SKIPPED_OUTSIDE_WINDOW, all in-window
  const baselineCand = await createCrawlCandidate({ providerKey: pk, status: BASELINE, observedInBaseline: true, trustedPublishedAt: IN_WINDOW });
  const shadowCand = await createCrawlCandidate({ providerKey: pk, status: DISCOVERED, observedInBaseline: false, trustedPublishedAt: IN_WINDOW });
  const outsideWindowCand = await createCrawlCandidate({ providerKey: pk, status: SKIPPED_OUTSIDE_WINDOW, observedInBaseline: false, trustedPublishedAt: IN_WINDOW });
  // ineligible: DISCOVERED but already observed-in-baseline (not a shadow)
  await createCrawlCandidate({ providerKey: pk, status: DISCOVERED, observedInBaseline: true, trustedPublishedAt: IN_WINDOW });
  // ineligible: out-of-window and unknown-date
  await createCrawlCandidate({ providerKey: pk, status: BASELINE, observedInBaseline: true, trustedPublishedAt: OUT_OF_WINDOW });
  await createCrawlCandidate({ providerKey: pk, status: BASELINE, observedInBaseline: true, trustedPublishedAt: null });
  // reported-but-never-recreated: already links a public Article
  const article = await prisma.article.create({ data: { id: id("article"), title: "known", content: "already public" } });
  await createCrawlCandidate({ providerKey: pk, status: BASELINE, observedInBaseline: true, trustedPublishedAt: IN_WINDOW, articleId: article.id });

  const preview = await previewBackfill({ providerKey: pk }, bounds());

  assert.equal(preview.observedBaselineCount, 1);
  assert.equal(preview.observedShadowCount, 1);
  assert.equal(preview.skippedOutsideWindowCount, 1);
  // Breakdown reconciles: eligibleCount === the three target buckets combined.
  assert.equal(preview.eligibleCount, 3);
  assert.equal(preview.knownWithArticleCount, 1);
  assert.equal(preview.effectiveReactivationCount, 3);

  // No run and no Jobs were created by the preview.
  assert.equal(await prisma.backfillRun.count({ where: { providerKey: pk } }), 0);
  assert.equal(await ingestJobFor(baselineCand.id), null);
  assert.equal(await ingestJobFor(shadowCand.id), null);
  assert.equal(await ingestJobFor(outsideWindowCand.id), null);
});

test("dry-run effectiveReactivationCount is capped by maxItems", { skip: !enabled }, async () => {
  const pk = providerKey("bf");
  await createCrawlCandidate({ providerKey: pk, status: BASELINE, observedInBaseline: true, trustedPublishedAt: IN_WINDOW });
  await createCrawlCandidate({ providerKey: pk, status: BASELINE, observedInBaseline: true, trustedPublishedAt: IN_WINDOW });
  const preview = await previewBackfill({ providerKey: pk }, bounds(1));
  assert.equal(preview.eligibleCount, 2);
  assert.equal(preview.effectiveReactivationCount, 1);
});

// ---------------------------------------------------------------------------
// Create: persists actor / reason / requested vs effective bounds / warnings.
// ---------------------------------------------------------------------------

test("createBackfillRun persists provenance and clamp warnings; getBackfillRun returns RUNNING DTO", { skip: !enabled }, async () => {
  const pk = providerKey("bf");
  runProviderKeys.add(pk);
  const now = new Date("2026-07-20T00:00:00.000Z");
  // A request wider than the ceiling so the policy records clamp warnings.
  const resolved = resolveEffectiveBackfillBounds(
    { windowStart: null, windowEnd: null, maxItems: 10_000 },
    { maxItemsCeiling: 5_000, maxWindowDays: 3_660 },
    now,
  );
  assert.equal(resolved.ok, true);
  if (!resolved.ok) return;

  const actorId = id("actor");
  const { id: runId } = await createBackfillRun({
    providerKey: pk,
    actorId,
    reason: "administrator approved historical backfill",
    requested: { windowStart: null, windowEnd: null, maxItems: 10_000 },
    effective: resolved.effective,
    warnings: resolved.warnings,
    now,
  });

  const run = await getBackfillRun(runId);
  assert.ok(run);
  assert.equal(run.status, BackfillRunStatus.RUNNING);
  assert.equal(run.providerKey, pk);
  assert.equal(run.actorId, actorId);
  assert.equal(run.reason, "administrator approved historical backfill");
  assert.equal(run.requestedMaxItems, 10_000);
  assert.equal(run.maxItems, 5_000); // clamped to ceiling
  assert.ok(run.warnings.includes("clamped-max-items"));
  assert.ok(run.windowStart && run.windowEnd);
  assert.equal(run.reactivatedCount, 0);
});

// ---------------------------------------------------------------------------
// Advance: reactivation + LOW-priority enqueue + governing invariant.
// ---------------------------------------------------------------------------

test("advance reactivates OBSERVED_BASELINE → QUEUED, flips observedInBaseline, enqueues a -100 ingest Job", { skip: !enabled }, async () => {
  const pk = providerKey("bf");
  const cand = await createCrawlCandidate({ providerKey: pk, status: BASELINE, observedInBaseline: true, trustedPublishedAt: IN_WINDOW });
  ingestCandidateIds.add(cand.id);
  const runId = await makeRun(pk);

  const outcome = await advanceBackfillRun({ runId, batchSize: 50 });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.ok === true && outcome.kind, "advanced");
  assert.equal(outcome.ok === true && outcome.kind === "advanced" && outcome.reactivated, 1);

  const after = await prisma.crawlCandidate.findUnique({ where: { id: cand.id } });
  assert.equal(after?.status, QUEUED);
  assert.equal(after?.observedInBaseline, false); // flip lets the unchanged handler ingest it

  const job = await ingestJobFor(cand.id);
  assert.ok(job, "a candidate-ingest job was enqueued");
  assert.equal(job?.priority, BACKFILL_JOB_PRIORITY);
  assert.equal(job?.priority, -100);

  const run = await getBackfillRun(runId);
  assert.equal(run?.reactivatedCount, 1);
  assert.equal(run?.matchedCount, 1);
  assert.equal(run?.checkpointCursor, cand.id);
});

test("advance reactivates OBSERVED_SHADOW (DISCOVERED + not observed-in-baseline)", { skip: !enabled }, async () => {
  const pk = providerKey("bf");
  const cand = await createCrawlCandidate({ providerKey: pk, status: DISCOVERED, observedInBaseline: false, trustedPublishedAt: IN_WINDOW });
  ingestCandidateIds.add(cand.id);
  const runId = await makeRun(pk);

  await advanceBackfillRun({ runId, batchSize: 50 });
  const after = await prisma.crawlCandidate.findUnique({ where: { id: cand.id } });
  assert.equal(after?.status, QUEUED);
  assert.ok(await ingestJobFor(cand.id));
});

test("advance reactivates SKIPPED_OUTSIDE_WINDOW → QUEUED and enqueues a -100 ingest Job (#1127)", { skip: !enabled }, async () => {
  const pk = providerKey("bf");
  const cand = await createCrawlCandidate({ providerKey: pk, status: SKIPPED_OUTSIDE_WINDOW, observedInBaseline: false, trustedPublishedAt: IN_WINDOW });
  ingestCandidateIds.add(cand.id);
  const runId = await makeRun(pk);

  const outcome = await advanceBackfillRun({ runId, batchSize: 50 });
  assert.equal(outcome.ok === true && outcome.kind === "advanced" && outcome.reactivated, 1);

  const after = await prisma.crawlCandidate.findUnique({ where: { id: cand.id } });
  assert.equal(after?.status, QUEUED);
  assert.equal(after?.observedInBaseline, false);

  const job = await ingestJobFor(cand.id);
  assert.ok(job, "a candidate-ingest job was enqueued for the reactivated outside-window candidate");
  assert.equal(job?.priority, BACKFILL_JOB_PRIORITY);

  const run = await getBackfillRun(runId);
  assert.equal(run?.reactivatedCount, 1);
});

test("governing invariant: a SKIPPED_OUTSIDE_WINDOW candidate with (or that lost) an Article is NEVER reactivated (#1127)", { skip: !enabled }, async () => {
  const pk = providerKey("bf");
  const article = await prisma.article.create({ data: { id: id("article"), title: "known", content: "public" } });
  const withArticle = await createCrawlCandidate({ providerKey: pk, status: SKIPPED_OUTSIDE_WINDOW, observedInBaseline: false, trustedPublishedAt: IN_WINDOW, articleId: article.id });
  const deletedArticle = await createCrawlCandidate({ providerKey: pk, status: SKIPPED_OUTSIDE_WINDOW, observedInBaseline: false, trustedPublishedAt: IN_WINDOW, articleDeletedAt: new Date() });
  for (const c of [withArticle.id, deletedArticle.id]) ingestCandidateIds.add(c);

  const runId = await makeRun(pk);
  const outcome = await advanceBackfillRun({ runId, batchSize: 50 });
  // Nothing eligible → the scan drains and completes without reactivating anyone.
  assert.equal(outcome.ok === true && outcome.kind, "completed");

  for (const candId of [withArticle.id, deletedArticle.id]) {
    const after = await prisma.crawlCandidate.findUnique({ where: { id: candId } });
    assert.equal(after?.status, SKIPPED_OUTSIDE_WINDOW, `candidate ${candId} must be untouched`);
    assert.equal(await ingestJobFor(candId), null, `candidate ${candId} must not be enqueued`);
  }
  const run = await getBackfillRun(runId);
  assert.equal(run?.reactivatedCount, 0);
});

test("governing invariant: has-article, deleted-article, out-of-window, and unknown-date identities are NEVER reactivated", { skip: !enabled }, async () => {
  const pk = providerKey("bf");
  const article = await prisma.article.create({ data: { id: id("article"), title: "known", content: "public" } });
  const withArticle = await createCrawlCandidate({ providerKey: pk, status: BASELINE, observedInBaseline: true, trustedPublishedAt: IN_WINDOW, articleId: article.id });
  const deletedArticle = await createCrawlCandidate({ providerKey: pk, status: BASELINE, observedInBaseline: true, trustedPublishedAt: IN_WINDOW, articleDeletedAt: new Date() });
  const outOfWindow = await createCrawlCandidate({ providerKey: pk, status: BASELINE, observedInBaseline: true, trustedPublishedAt: OUT_OF_WINDOW });
  const unknownDate = await createCrawlCandidate({ providerKey: pk, status: BASELINE, observedInBaseline: true, trustedPublishedAt: null });
  for (const c of [withArticle.id, deletedArticle.id, outOfWindow.id, unknownDate.id]) ingestCandidateIds.add(c);

  const runId = await makeRun(pk);
  const outcome = await advanceBackfillRun({ runId, batchSize: 50 });
  // Nothing eligible → the scan drains and completes without reactivating anyone.
  assert.equal(outcome.ok === true && outcome.kind, "completed");

  for (const candId of [withArticle.id, deletedArticle.id, outOfWindow.id, unknownDate.id]) {
    const after = await prisma.crawlCandidate.findUnique({ where: { id: candId } });
    assert.equal(after?.status, BASELINE, `candidate ${candId} must be untouched`);
    assert.equal(await ingestJobFor(candId), null, `candidate ${candId} must not be enqueued`);
  }
  const run = await getBackfillRun(runId);
  assert.equal(run?.reactivatedCount, 0);
});

// ---------------------------------------------------------------------------
// Bounds: the item cap completes the run; the range never widens.
// ---------------------------------------------------------------------------

test("the maxItems cap bounds the run: only the budget is reactivated, then COMPLETED (budget-reached)", { skip: !enabled }, async () => {
  const pk = providerKey("bf");
  const c1 = await createCrawlCandidate({ providerKey: pk, status: BASELINE, observedInBaseline: true, trustedPublishedAt: IN_WINDOW });
  const c2 = await createCrawlCandidate({ providerKey: pk, status: BASELINE, observedInBaseline: true, trustedPublishedAt: IN_WINDOW });
  ingestCandidateIds.add(c1.id);
  ingestCandidateIds.add(c2.id);
  const runId = await makeRun(pk, { maxItems: 1 });

  const first = await advanceBackfillRun({ runId, batchSize: 50 });
  assert.equal(first.ok === true && first.kind === "advanced" && first.reactivated, 1);
  const second = await advanceBackfillRun({ runId, batchSize: 50 });
  assert.equal(second.ok === true && second.kind, "completed");
  assert.equal(second.ok === true && second.kind === "completed" && second.reason, "budget-reached");

  const run = await getBackfillRun(runId);
  assert.equal(run?.reactivatedCount, 1);
  assert.equal(run?.status, BackfillRunStatus.COMPLETED);
  // Exactly one of the two candidates was reactivated (the range never widened).
  const queued = await prisma.crawlCandidate.count({ where: { providerKey: pk, status: QUEUED } });
  assert.equal(queued, 1);
});

// ---------------------------------------------------------------------------
// Checkpoint / restart: resume from the cursor, never double-reactivate.
// ---------------------------------------------------------------------------

test("batched advance resumes from the checkpoint and NEVER double-reactivates (restart-safe)", { skip: !enabled }, async () => {
  const pk = providerKey("bf");
  const c1 = await createCrawlCandidate({ providerKey: pk, status: BASELINE, observedInBaseline: true, trustedPublishedAt: IN_WINDOW });
  const c2 = await createCrawlCandidate({ providerKey: pk, status: DISCOVERED, observedInBaseline: false, trustedPublishedAt: IN_WINDOW });
  ingestCandidateIds.add(c1.id);
  ingestCandidateIds.add(c2.id);
  const runId = await makeRun(pk);

  // batchSize 1 → two advances, one candidate each; the cursor drives resumption.
  const a1 = await advanceBackfillRun({ runId, batchSize: 1 });
  assert.equal(a1.ok === true && a1.kind === "advanced" && a1.reactivated, 1);
  const a2 = await advanceBackfillRun({ runId, batchSize: 1 });
  assert.equal(a2.ok === true && a2.kind === "advanced" && a2.reactivated, 1);
  const a3 = await advanceBackfillRun({ runId, batchSize: 1 });
  assert.equal(a3.ok === true && a3.kind, "completed"); // drained

  const run = await getBackfillRun(runId);
  assert.equal(run?.reactivatedCount, 2);

  // Each candidate has EXACTLY one ingest job (idempotent enqueue, no duplicates).
  for (const cid of [c1.id, c2.id]) {
    const jobs = await prisma.job.count({ where: { dedupeKey: candidateIngestDedupeKey(cid, CANDIDATE_INGEST_PROCESSING_VERSION) } });
    assert.equal(jobs, 1, `candidate ${cid} must have exactly one ingest job`);
  }

  // A fresh run over the SAME (now QUEUED) identities reactivates nothing — proof
  // that a lost checkpoint / restart can never revive an already-processed one.
  const rerunId = await makeRun(pk);
  const rerun = await advanceBackfillRun({ runId: rerunId, batchSize: 50 });
  assert.equal(rerun.ok === true && rerun.kind, "completed");
  assert.equal((await getBackfillRun(rerunId))?.reactivatedCount, 0);
});

// ---------------------------------------------------------------------------
// Lifecycle: pause blocks the advance, resume re-enables, cancel is terminal.
// ---------------------------------------------------------------------------

test("pause blocks the advance (inactive); resume re-enables it; both are idempotent", { skip: !enabled }, async () => {
  const pk = providerKey("bf");
  const cand = await createCrawlCandidate({ providerKey: pk, status: BASELINE, observedInBaseline: true, trustedPublishedAt: IN_WINDOW });
  ingestCandidateIds.add(cand.id);
  const runId = await makeRun(pk);

  const paused = await pauseBackfillRun(runId);
  assert.equal(paused.ok === true && paused.kind, "applied");
  assert.equal((await getBackfillRun(runId))?.status, BackfillRunStatus.PAUSED);

  // Advancing a paused run does nothing (no reactivation, no Job).
  const whilePaused = await advanceBackfillRun({ runId, batchSize: 50 });
  assert.equal(whilePaused.ok === true && whilePaused.kind, "inactive");
  assert.equal((await prisma.crawlCandidate.findUnique({ where: { id: cand.id } }))?.status, BASELINE);
  assert.equal(await ingestJobFor(cand.id), null);

  // Pausing again is an idempotent no-op.
  const pauseAgain = await pauseBackfillRun(runId);
  assert.equal(pauseAgain.ok === true && pauseAgain.kind, "noop");

  // Resume re-enables the advance.
  const resumed = await resumeBackfillRun(runId);
  assert.equal(resumed.ok === true && resumed.kind, "applied");
  const afterResume = await advanceBackfillRun({ runId, batchSize: 50 });
  assert.equal(afterResume.ok === true && afterResume.kind === "advanced" && afterResume.reactivated, 1);
});

test("cancel is terminal: a cancelled run cannot advance and cannot be paused", { skip: !enabled }, async () => {
  const pk = providerKey("bf");
  const cand = await createCrawlCandidate({ providerKey: pk, status: BASELINE, observedInBaseline: true, trustedPublishedAt: IN_WINDOW });
  ingestCandidateIds.add(cand.id);
  const runId = await makeRun(pk);

  const cancelled = await cancelBackfillRun(runId);
  assert.equal(cancelled.ok === true && cancelled.kind, "applied");
  assert.equal((await getBackfillRun(runId))?.status, BackfillRunStatus.CANCELLED);

  const advance = await advanceBackfillRun({ runId, batchSize: 50 });
  assert.equal(advance.ok === true && advance.kind, "inactive");
  assert.equal(await ingestJobFor(cand.id), null);

  const pauseTerminal = await applyBackfillControl({ runId, action: "pause" });
  assert.equal(pauseTerminal.ok, false);
  assert.equal(pauseTerminal.ok === false && pauseTerminal.reason, "illegal");
});

// ---------------------------------------------------------------------------
// listRunnableBackfillRunIds: only RUNNING runs are advanced by the loop.
// ---------------------------------------------------------------------------

test("listRunnableBackfillRunIds returns only RUNNING runs", { skip: !enabled }, async () => {
  const pk = providerKey("bf");
  const running = await makeRun(pk);
  const pausedId = await makeRun(pk);
  await pauseBackfillRun(pausedId);

  const runnable = await listRunnableBackfillRunIds(100);
  assert.ok(runnable.includes(running));
  assert.ok(!runnable.includes(pausedId));
});

// ---------------------------------------------------------------------------
// Contention: real-time ingest is claimed BEFORE backfill under queue pressure.
// ---------------------------------------------------------------------------

test("contention: a real-time ingest Job (priority 0) is claimed BEFORE a backfill Job (-100)", { skip: !enabled }, async () => {
  const realtimePk = providerKey("rt");
  const backfillPk = providerKey("bf");

  // Real-time candidate + its normal-priority ingest Job.
  const realtimeCand = await createCrawlCandidate({ providerKey: realtimePk, status: QUEUED, observedInBaseline: false });
  ingestCandidateIds.add(realtimeCand.id);
  await prisma.$transaction((tx) => enqueueCandidateIngestInTx(tx, realtimeCand.id, { priority: 0 }));

  // Backfill candidate reactivated by an approved run → its -100 ingest Job.
  const backfillCand = await createCrawlCandidate({ providerKey: backfillPk, status: BASELINE, observedInBaseline: true, trustedPublishedAt: IN_WINDOW });
  ingestCandidateIds.add(backfillCand.id);
  const runId = await makeRun(backfillPk);
  await advanceBackfillRun({ runId, batchSize: 50 });

  // The claimer orders by priority DESC, so EVERY priority-0 job (including our
  // real-time one) is claimed before ANY -100 backfill job. Claim in sequence
  // and record where OUR two jobs land — robust to unrelated queue rows.
  let realtimeAt = -1;
  let backfillAt = -1;
  for (let i = 0; i < 500 && !(realtimeAt >= 0 && backfillAt >= 0); i += 1) {
    const job = await claimNextJob(`worker-contention-${i}`, { types: [JobType.ARTICLE_INGEST] });
    if (!job) break;
    const candidateId = (job.payload as { candidateId?: string }).candidateId;
    if (candidateId === realtimeCand.id) realtimeAt = i;
    else if (candidateId === backfillCand.id) backfillAt = i;
  }

  assert.ok(realtimeAt >= 0, "real-time ingest job was claimed");
  assert.ok(backfillAt >= 0, "backfill ingest job was claimed");
  assert.ok(realtimeAt < backfillAt, "the real-time job is claimed before the backfill job");
});

// ---------------------------------------------------------------------------
// Audit: a sanitized backfill audit entry persists and is queryable.
// ---------------------------------------------------------------------------

test("a backfill create audit entry persists with sanitized metadata (no URL/content)", { skip: !enabled }, async () => {
  const pk = providerKey("bf");
  const runId = await makeRun(pk);
  const actorId = id("actor");

  await recordAuditLog({
    action: AUDIT_ACTIONS.adminBackfillCreate,
    actorId,
    actorRole: "Admin",
    targetType: "backfill_run",
    targetId: runId,
    metadata: { providerKey: pk, reason: "gap remediation", effectiveMaxItems: 100, warnings: ["clamped-window-span"] },
  });

  const rows = await prisma.auditLog.findMany({ where: { actorId, action: AUDIT_ACTIONS.adminBackfillCreate } });
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.targetId, runId);
  assert.doesNotMatch(rows[0]?.metadata ?? "", /https?:\/\//);
});
