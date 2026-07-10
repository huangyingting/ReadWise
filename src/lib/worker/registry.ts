import { type processArticle, type ProcessOptions } from "@/lib/processing/processor";
import { JobError, JobType, type Job } from "@/lib/jobs";
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
 * Creates the default handler registry with all built-in job type handlers.
 *
 * - ARTICLE_INGEST, ARTICLE_PROCESS, AI_REBUILD, TTS_GENERATE all delegate to
 *   the article processing adapter.
 * - PUSH_REMINDER is a no-op: it has its own dedicated pipeline
 *   (scripts/push-reminders.ts). This prevents unconfigured deployments from
 *   dead-lettering PUSH_REMINDER jobs.
 */
export function createDefaultRegistry(processFn: typeof processArticle): JobHandlerRegistry {
  const articleHandler = makeArticleHandler(processFn);
  return new JobHandlerRegistry({
    [JobType.ARTICLE_INGEST]: articleHandler,
    [JobType.ARTICLE_PROCESS]: articleHandler,
    [JobType.AI_REBUILD]: articleHandler,
    [JobType.TTS_GENERATE]: articleHandler,
    [JobType.PUSH_REMINDER]: async (job, ctx) => {
      ctx.logger.info("push reminder job acknowledged (no-op handler)", { jobId: job.id });
    },
  });
}
