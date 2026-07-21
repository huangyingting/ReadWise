import { type processArticle, type ProcessOptions } from "@/lib/processing/processor";
import { JobError, JobType, parseCandidateIngestPayload, isCandidateIngestPayload, type Job } from "@/lib/jobs";
import { sendPushReminderForUser } from "@/lib/push/scheduler";
import { retryPolicyFor } from "@/lib/jobs/retry-policy";
import { CrawlCandidateStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { scraperIngestPropagationGraceMs } from "@/lib/runtime-config/scraper";
import {
  classifyIngestAttempt,
  CURRENT_EXTRACTOR_VERSION,
  type IngestAttemptOutcome,
  type IngestClassification,
  type IngestScheduleConfig,
} from "@/lib/scraper/incremental/ingest-outcome";
import type { WorkerLogger, JobHandler } from "./types";
type ArticleJobPayload = {
  articleId?: string;
  tts?: boolean;
  translateLangs?: string[];
};

type PushReminderJobPayload = {
  userId?: string;
};

function isPayloadRecord(payload: unknown): payload is Record<string, unknown> {
  return payload !== null && typeof payload === "object" && !Array.isArray(payload);
}

function payloadStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : undefined;
}

function articlePayload(job: Job): ArticleJobPayload {
  const payload = isPayloadRecord(job.payload) ? job.payload : {};
  const articleId = typeof payload.articleId === "string" ? payload.articleId : undefined;
  const tts = typeof payload.tts === "boolean" ? payload.tts : undefined;
  const translateLangs = payloadStringArray(payload.translateLangs);
  return { articleId, tts, translateLangs };
}

function pushReminderPayload(job: Job): PushReminderJobPayload {
  const payload = isPayloadRecord(job.payload) ? job.payload : {};
  return {
    userId: typeof payload.userId === "string" ? payload.userId : undefined,
  };
}

function failedStepSummary(
  steps: Array<{ step: string; status: string; detail?: string | null }>,
): string {
  return steps
    .filter((step) => step.status === "failed")
    .map((step) => `${step.step}: ${step.detail ?? "unknown"}`)
    .join("; ");
}

/**
 * Registry mapping JobType → JobHandler. Supports testable registration and
 * override of individual handlers.
 */
export class JobHandlerRegistry {
  private readonly map: Map<JobType, JobHandler>;

  constructor(initial?: Partial<Record<JobType, JobHandler>>) {
    this.map = new Map(
      Object.entries(initial ?? {}) as [JobType, JobHandler][],
    );
  }

  register(type: JobType, handler: JobHandler): void {
    this.map.set(type, handler);
  }

  get(type: JobType): JobHandler | undefined {
    return this.map.get(type);
  }

  /** Returns a plain record suitable for spread-merge with option overrides. */
  toRecord(): Partial<Record<JobType, JobHandler>> {
    return Object.fromEntries(this.map) as Partial<Record<JobType, JobHandler>>;
  }
}

/**
 * Builds a handler that enriches an article via the idempotent processor. A
 * missing article or a payload without `articleId` is a permanent failure
 * (dead-letter, not retried); a processor step failure is transient (retried).
 */
export function makeArticleHandler(processFn: typeof processArticle): JobHandler {
  return async (job: Job, ctx: { logger: WorkerLogger; signal?: AbortSignal; process?: ProcessOptions }) => {
    const payload = articlePayload(job);
    const articleId = payload.articleId;
    if (!articleId) {
      throw new JobError("job payload missing articleId", { kind: "validation" });
    }

    const result = await processFn(articleId, {
      tts: payload.tts ?? ctx.process?.tts,
      translateLangs: payload.translateLangs ?? ctx.process?.translateLangs,
    });
    if (result === null) {
      throw new JobError(`article ${articleId} not found`, { kind: "missing" });
    }
    if (!result.ok) {
      const failedSteps = failedStepSummary(result.steps);
      throw new JobError(`processing failed (${failedSteps || "unknown"})`, { kind: "provider" });
    }
    ctx.logger.info("article job processed", {
      jobId: job.id,
      articleId,
      published: result.published,
    });
  };
}

export function makePushReminderHandler(
  sendReminder: typeof sendPushReminderForUser = sendPushReminderForUser,
): JobHandler {
  return async (job: Job, ctx: { logger: WorkerLogger }) => {
    const payload = pushReminderPayload(job);
    if (!payload.userId) {
      throw new JobError("job payload missing userId", { kind: "validation" });
    }

    const result = await sendReminder(payload.userId);
    ctx.logger.info("push reminder job processed", {
      jobId: job.id,
      userId: payload.userId,
      sent: result.sent,
      skipped: result.skipped,
      suppressed: result.suppressed,
      reason: result.reason ?? null,
    });
  };
}

/**
 * Minimal candidate projection the ingest hand-off needs. METADATA ONLY — never
 * a URL or article content. Includes the #1093 retry metadata the classifier
 * needs (attempt count + grace-window anchor).
 */
export type CandidateIngestRow = {
  id: string;
  status: CrawlCandidateStatus;
  observedInBaseline: boolean;
  articleId: string | null;
  ingestAttemptCount: number;
  firstIngestAttemptAt: Date | null;
};

/** Resolves a candidate by id at job-execution time. Injected for testability. */
export type LoadCandidateFn = (candidateId: string) => Promise<CandidateIngestRow | null>;

/**
 * Result of a #1095 fetch/extract/Article-creation attempt supplied to the
 * classification seam: success, or a normalized failure OUTCOME (never a body).
 */
export type IngestAttemptResult = { ok: true } | { ok: false; outcome: IngestAttemptOutcome };

/**
 * The #1095 fetch/extract/Article-creation attempt. Injected at the classification
 * seam; absent by default so the handler stops at the hand-off no-op (fetch/
 * extract is NOT implemented in #1091/#1093).
 */
export type IngestAttemptRunner = (
  candidate: CandidateIngestRow,
  ctx: { logger: WorkerLogger; job: Job },
) => Promise<IngestAttemptResult>;

/** Optional dependencies wiring the #1093 classification seam into the handler. */
export type CandidateIngestDeps = {
  runIngestAttempt?: IngestAttemptRunner;
  /** Backoff + grace tuning; defaults from the ARTICLE_INGEST policy + runtime config. */
  scheduleConfig?: IngestScheduleConfig;
  /** Extractor version producing outcomes (recorded for reactivation gating). */
  extractorVersion?: number;
  /** Injected clock (tests). */
  now?: () => Date;
};

/**
 * Candidate statuses for which ingestion is already finished — never re-ingest.
 * Includes QUARANTINED (#1093), the #1092 parks (CONFLICT / DUPLICATE_ALIAS /
 * NEEDS_REVIEW), and the #1100 operator review-rejection (SKIPPED_REVIEW) so a
 * reclaimed job on an already-resolved candidate is a safe no-op that never
 * revives it (governing invariant).
 */
const TERMINAL_CANDIDATE_STATUSES = new Set<CrawlCandidateStatus>([
  CrawlCandidateStatus.INGESTED,
  CrawlCandidateStatus.REJECTED,
  CrawlCandidateStatus.SKIPPED,
  CrawlCandidateStatus.QUARANTINED,
  CrawlCandidateStatus.CONFLICT,
  CrawlCandidateStatus.DUPLICATE_ALIAS,
  CrawlCandidateStatus.NEEDS_REVIEW,
  CrawlCandidateStatus.SKIPPED_REVIEW,
]);

async function defaultLoadCandidate(candidateId: string): Promise<CandidateIngestRow | null> {
  return prisma.crawlCandidate.findUnique({
    where: { id: candidateId },
    select: {
      id: true,
      status: true,
      observedInBaseline: true,
      articleId: true,
      ingestAttemptCount: true,
      firstIngestAttemptAt: true,
    },
  });
}

/** Default classifier tuning: ARTICLE_INGEST retry policy + configured grace window. */
function defaultScheduleConfig(): IngestScheduleConfig {
  const policy = retryPolicyFor(JobType.ARTICLE_INGEST);
  return {
    maxAttempts: policy.maxAttempts,
    baseBackoffMs: policy.baseBackoffMs,
    maxBackoffMs: policy.maxBackoffMs,
    propagationGraceMs: scraperIngestPropagationGraceMs(),
  };
}

/**
 * Translates a classification into the JobError the worker's fail path expects,
 * so the Job is rescheduled (transient) or dead-lettered (terminal/quarantine)
 * by the canonical `failJob` machinery. The message is the machine reason code
 * only — never a response body or URL (AC4).
 */
function ingestClassificationToJobError(classification: IngestClassification): JobError {
  const permanent = classification.disposition !== "retry";
  return new JobError(classification.reason, { kind: "provider", permanent });
}

/**
 * Handler for candidate-based ARTICLE_INGEST jobs (#1091 / #1093). Resolves the
 * candidate from the ledger by id, guards the governing invariant, then hands off
 * to the injected #1095 fetch/extract/Article-creation attempt via the #1093
 * classification seam. NEVER logs or persists a URL or article content (AC4).
 *
 * - Malformed payload (no candidateId) → permanent validation failure.
 * - Missing candidate → permanent "missing" failure (dead-letter, not retried).
 * - Terminal / already-linked / baseline-observed candidate → safe no-op: a
 *   known identity is never revived or re-ingested (governing invariant).
 * - No `runIngestAttempt` injected → resolve + validate, then stop at the #1095
 *   hand-off no-op (fetch/extract is NOT implemented here).
 * - With `runIngestAttempt`: on failure, classify the outcome (pure), persist the
 *   candidate transition (retry / quarantine / terminal), and throw the mapped
 *   JobError so the canonical `failJob` machinery reschedules or dead-letters the
 *   Job.
 */
export function makeCandidateIngestHandler(
  loadCandidate: LoadCandidateFn,
  deps: CandidateIngestDeps = {},
): JobHandler {
  return async (job: Job, ctx: { logger: WorkerLogger }) => {
    const parsed = parseCandidateIngestPayload(job.payload);
    if (!parsed) {
      throw new JobError("article ingest payload missing candidateId", { kind: "validation" });
    }
    const candidate = await loadCandidate(parsed.candidateId);
    if (!candidate) {
      throw new JobError(`crawl candidate ${parsed.candidateId} not found`, { kind: "missing" });
    }
    if (
      candidate.observedInBaseline ||
      candidate.articleId != null ||
      TERMINAL_CANDIDATE_STATUSES.has(candidate.status)
    ) {
      ctx.logger.info("article ingest skipped: candidate already known/terminal", {
        jobId: job.id,
        candidateId: candidate.id,
        status: candidate.status,
      });
      return;
    }

    if (!deps.runIngestAttempt) {
      // Hand-off boundary: fetch / extract / Article creation lands in #1095. No
      // fetch or Article creation here — only durable resolution + the seam.
      ctx.logger.info("article ingest resolved candidate; ingestion pipeline lands in #1095", {
        jobId: job.id,
        candidateId: candidate.id,
        processingVersion: parsed.processingVersion,
      });
      return;
    }

    const result = await deps.runIngestAttempt(candidate, { logger: ctx.logger, job });
    if (result.ok) {
      // #1095 created/linked the Article; nothing to classify.
      ctx.logger.info("article ingest attempt succeeded", {
        jobId: job.id,
        candidateId: candidate.id,
      });
      return;
    }

    const now = deps.now?.() ?? new Date();
    const config = deps.scheduleConfig ?? defaultScheduleConfig();
    const extractorVersion = deps.extractorVersion ?? CURRENT_EXTRACTOR_VERSION;
    const classification = classifyIngestAttempt({
      outcome: result.outcome,
      now,
      attemptNumber: candidate.ingestAttemptCount + 1,
      firstAttemptAt: candidate.firstIngestAttemptAt,
      config,
    });

    // Persist the candidate recovery transition (guarded, restart-safe). The Job
    // itself is transitioned by the worker's `failJob` via the thrown JobError,
    // keeping the canonical queue metrics + error-history intact. Lazily imported
    // so the default worker-registry import graph (used widely) stays free of the
    // enqueue/metrics chain until the #1095 seam is actually wired in.
    const { applyIngestClassification } = await import(
      "@/lib/scraper/incremental/ingest-recovery"
    );
    await applyIngestClassification({
      candidateId: candidate.id,
      classification,
      now,
      extractorVersion,
    });

    ctx.logger.info("article ingest attempt failed; recovery applied", {
      jobId: job.id,
      candidateId: candidate.id,
      disposition: classification.disposition,
      reason: classification.reason,
    });
    throw ingestClassificationToJobError(classification);
  };
}

/**
 * Creates the default handler registry with all built-in job type handlers.
 * - ARTICLE_INGEST dispatches on payload shape: a candidate-based payload
 *   (`{ candidateId, processingVersion }`, #1091) resolves the candidate from
 *   the ledger and runs the #1095 fetch/extract/atomic-save pipeline when a
 *   `runIngestAttempt` runner is supplied via `candidateIngestDeps` (see
 *   `createIngestAttemptRunner`); with no runner it stays a safe hand-off no-op.
 *   The legacy url/articleId ArticleIngest payload delegates to the processor.
 * - ARTICLE_PROCESS, AI_REBUILD, TTS_GENERATE all delegate to the article
 *   processing adapter.
 * - PUSH_REMINDER dispatches a single-user reminder through the same push
 *   scheduler/delivery helpers as scripts/push-reminders.ts.
 */
export function createDefaultRegistry(
  processFn: typeof processArticle,
  loadCandidate: LoadCandidateFn = defaultLoadCandidate,
  candidateIngestDeps: CandidateIngestDeps = {},
): JobHandlerRegistry {
  const articleHandler = makeArticleHandler(processFn);
  const candidateIngestHandler = makeCandidateIngestHandler(loadCandidate, candidateIngestDeps);
  const pushReminderHandler = makePushReminderHandler();
  return new JobHandlerRegistry({
    [JobType.ARTICLE_INGEST]: async (job, ctx) => {
      // Candidate-based incremental ingest (#1091) vs. legacy url/articleId path.
      if (isCandidateIngestPayload(job.payload)) return candidateIngestHandler(job, ctx);
      return articleHandler(job, ctx);
    },
    [JobType.ARTICLE_PROCESS]: articleHandler,
    [JobType.AI_REBUILD]: articleHandler,
    [JobType.TTS_GENERATE]: articleHandler,
    [JobType.PUSH_REMINDER]: pushReminderHandler,
  });
}
