import { type processArticle, type ProcessOptions } from "@/lib/processing/processor";
import { JobError, JobType, parseCandidateIngestPayload, isCandidateIngestPayload, type Job } from "@/lib/jobs";
import { CrawlCandidateStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { WorkerLogger, JobHandler } from "./types";

type ArticleJobPayload = {
  articleId?: string;
  tts?: boolean;
  translateLangs?: string[];
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

/**
 * Minimal candidate projection the ingest hand-off needs. METADATA ONLY — never
 * a URL or article content.
 */
export type CandidateIngestRow = {
  id: string;
  status: CrawlCandidateStatus;
  observedInBaseline: boolean;
  articleId: string | null;
};

/** Resolves a candidate by id at job-execution time. Injected for testability. */
export type LoadCandidateFn = (candidateId: string) => Promise<CandidateIngestRow | null>;

/** Candidate statuses for which ingestion is already finished — never re-ingest. */
const TERMINAL_CANDIDATE_STATUSES = new Set<CrawlCandidateStatus>([
  CrawlCandidateStatus.INGESTED,
  CrawlCandidateStatus.REJECTED,
  CrawlCandidateStatus.SKIPPED,
]);

async function defaultLoadCandidate(candidateId: string): Promise<CandidateIngestRow | null> {
  return prisma.crawlCandidate.findUnique({
    where: { id: candidateId },
    select: { id: true, status: true, observedInBaseline: true, articleId: true },
  });
}

/**
 * Handler for candidate-based ARTICLE_INGEST jobs (#1091, Phase 2.1). Resolves
 * the candidate from the ledger by id, guards the governing invariant, and
 * leaves the fetch/extract/Article-creation hand-off to #1095 (explicitly OUT
 * OF SCOPE here). NEVER logs or persists a URL or article content (AC4).
 *
 * - Malformed payload (no candidateId) → permanent validation failure.
 * - Missing candidate → permanent "missing" failure (dead-letter, not retried).
 * - Terminal / already-linked / baseline-observed candidate → safe no-op: a
 *   known identity is never revived or re-ingested (governing invariant).
 * - Otherwise → resolve + validate, then a clear no-op hand-off point for #1095.
 */
export function makeCandidateIngestHandler(loadCandidate: LoadCandidateFn): JobHandler {
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
    // Hand-off boundary: fetch / extract / Article creation lands in #1095. This
    // issue (#1091) only durably ENQUEUES + resolves the candidate; do NOT fetch
    // or create an Article here.
    ctx.logger.info("article ingest resolved candidate; ingestion pipeline lands in #1095", {
      jobId: job.id,
      candidateId: candidate.id,
      processingVersion: parsed.processingVersion,
    });
  };
}

/**
 * Creates the default handler registry with all built-in job type handlers.
 * - ARTICLE_INGEST dispatches on payload shape: a candidate-based payload
 *   (`{ candidateId, processingVersion }`, #1091) resolves the candidate from
 *   the ledger and hands off to the #1095 ingestion pipeline; the legacy
 *   url/articleId ArticleIngest payload delegates to the article processor.
 * - ARTICLE_PROCESS, AI_REBUILD, TTS_GENERATE all delegate to the article
 *   processing adapter.
 * - PUSH_REMINDER is a no-op: it has its own dedicated pipeline
 *   (scripts/push-reminders.ts). This prevents unconfigured deployments from
 *   dead-lettering PUSH_REMINDER jobs.
 */
export function createDefaultRegistry(
  processFn: typeof processArticle,
  loadCandidate: LoadCandidateFn = defaultLoadCandidate,
): JobHandlerRegistry {
  const articleHandler = makeArticleHandler(processFn);
  const candidateIngestHandler = makeCandidateIngestHandler(loadCandidate);
  return new JobHandlerRegistry({
    [JobType.ARTICLE_INGEST]: async (job, ctx) => {
      // Candidate-based incremental ingest (#1091) vs. legacy url/articleId path.
      if (isCandidateIngestPayload(job.payload)) return candidateIngestHandler(job, ctx);
      return articleHandler(job, ctx);
    },
    [JobType.ARTICLE_PROCESS]: articleHandler,
    [JobType.AI_REBUILD]: articleHandler,
    [JobType.TTS_GENERATE]: articleHandler,
    [JobType.PUSH_REMINDER]: async (job, ctx) => {
      ctx.logger.info("push reminder job acknowledged (no-op handler)", { jobId: job.id });
    },
  });
}
