/**
 * The candidate ingest ATTEMPT runner (issue #1095, Phase 2.5): the real
 * fetch → extract → resolve → atomic-save orchestration the #1093 worker seam
 * (`makeCandidateIngestHandler`'s `runIngestAttempt`) calls. It is the ONE place
 * that turns a resolved eligible candidate into EXACTLY one DRAFT Article plus
 * its required downstream work, honoring the house architecture:
 *
 *   - Fetch + extraction + the final CHECKS (canonical, fingerprint, date,
 *     source ownership, quality, access) are IMPURE and happen OUTSIDE any
 *     transaction, behind the injected {@link PrepareArticleDraft} seam. That
 *     seam returns a normalized {@link PreparedDraft}: a ready draft, a transient/
 *     terminal FAILURE outcome (classified + retried/quarantined by #1093), or a
 *     deterministic non-saving STOP (e.g. a trusted outside-window date).
 *   - Identity/fingerprint RESOLUTION reuses the #1092 pure resolver + guarded
 *     convergence via {@link applyFinalIdentity} (URL variants and same-provider
 *     duplicates fold onto ONE winner; a known Article, an alias loser, a
 *     canonical conflict, or a cross-provider body match STOP before any Article
 *     is created — no downstream job for them).
 *   - The final all-or-nothing commit (Article + candidate terminal +
 *     ARTICLE_PROCESS enqueue, with the source activation-generation revalidation)
 *     is {@link saveIncrementalArticle}.
 *
 * Expensive AI/narration is NOT run here — it is the asynchronous ARTICLE_PROCESS
 * job the save enqueues. Optional-provider graceful fallback is preserved: this
 * module never hard-requires AI/Speech/etc.
 *
 * PRIVACY: only machine reason codes, ids, counts, and timestamps are logged;
 * never a URL, query string, secret, cookie, or article prose. The draft's
 * `sourceUrl`/`canonicalUrl` are written to the Article (product data) but never
 * to a log line or a candidate reason/error field.
 */
import type { Job } from "@/lib/jobs";

import { computeProseFingerprint } from "./prose-fingerprint";
import { applyFinalIdentity } from "./final-identity-commit";
import { saveIncrementalArticle, type ArticleDraft } from "./article-save-commit";
import type { IngestAttemptOutcome } from "./ingest-outcome";
import type {
  CandidateIngestRow,
  IngestAttemptResult,
  IngestAttemptRunner,
} from "@/lib/worker/registry";
import type { WorkerLogger } from "@/lib/worker/types";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

/** Full candidate projection the runner needs (secret-free). */
const RUNNER_CANDIDATE_SELECT = {
  id: true,
  providerKey: true,
  discoverySourceId: true,
  status: true,
  observedInBaseline: true,
  articleId: true,
} satisfies Prisma.CrawlCandidateSelect;

export type RunnerCandidate = Prisma.CrawlCandidateGetPayload<{ select: typeof RUNNER_CANDIDATE_SELECT }>;

/** Source activation-generation snapshot captured BEFORE the fetch. */
export type RunnerSource = {
  lifecycleMode: string;
  definitionVersion: number;
  activatedAt: Date | null;
  activationGeneration: number;
};

/** The extracted draft body/fields, minus the URLs (derived from the fetch). */
export type ExtractedArticleFields = Omit<ArticleDraft, "sourceUrl" | "canonicalUrl">;

/** Normalized outcome of the impure fetch/extract/final-check seam. */
export type PreparedDraft =
  /** Fetched + extracted + all final checks passed — ready to resolve + save. */
  | {
      kind: "draft";
      /** The fetched final URL after redirects. */
      finalUrl: string;
      /** Declared `<link rel="canonical">` when present. */
      canonicalUrl?: string | null;
      /** Extracted prose for the versioned body fingerprint (never persisted raw). */
      prose: string;
      /** Extracted article fields (title/content/author/excerpt/etc). */
      fields: ExtractedArticleFields;
    }
  /** A transient/terminal fetch/extract failure — classified + scheduled by #1093. */
  | { kind: "failure"; outcome: IngestAttemptOutcome }
  /** A deterministic non-saving stop (e.g. trusted outside-window date): NO Article. */
  | { kind: "stop"; reason: string };

/** Inputs the {@link PrepareArticleDraft} seam receives (reads-before-tx, impure). */
export type PrepareDraftContext = {
  candidate: RunnerCandidate;
  source: RunnerSource | null;
  logger: WorkerLogger;
  job: Job;
  now: Date;
};

/**
 * The IMPURE fetch → extract → final-check seam. Injected so the runner stays
 * unit-testable without a network, and so the production wiring (SSRF-safe fetch,
 * extractor, quality gate, date-window, access) lands behind ONE boundary. It
 * MUST NOT create an Article, run AI/narration, or open a transaction.
 */
export type PrepareArticleDraft = (ctx: PrepareDraftContext) => Promise<PreparedDraft>;

/** Dependencies for {@link createIngestAttemptRunner}. */
export type IngestRunnerDeps = {
  /** The impure fetch/extract/final-check seam (required). */
  prepareDraft: PrepareArticleDraft;
  /** Injected clock (tests). */
  now?: () => Date;
  /** Overridable for tests. */
  loadContext?: (candidateId: string) => Promise<{ candidate: RunnerCandidate; source: RunnerSource | null } | null>;
  applyFinalIdentityFn?: typeof applyFinalIdentity;
  saveFn?: typeof saveIncrementalArticle;
};

async function defaultLoadContext(
  candidateId: string,
): Promise<{ candidate: RunnerCandidate; source: RunnerSource | null } | null> {
  const candidate = await prisma.crawlCandidate.findUnique({
    where: { id: candidateId },
    select: RUNNER_CANDIDATE_SELECT,
  });
  if (!candidate) return null;
  const source = candidate.discoverySourceId
    ? await prisma.discoverySource.findUnique({
        where: { id: candidate.discoverySourceId },
        select: { lifecycleMode: true, definitionVersion: true, activatedAt: true, activationGeneration: true },
      })
    : null;
  return { candidate, source };
}

/**
 * Builds the {@link IngestAttemptRunner} wired into the candidate-ingest handler.
 * On each attempt it: re-reads the candidate + source (outside the tx), runs the
 * injected fetch/extract/final-check seam, resolves the final identity, and — for
 * a genuinely-new public identity only — performs the atomic save. Every
 * non-saving outcome returns `{ ok: true }` (a deterministic completion, NOT a
 * retry): the candidate is already parked/terminal, or the source generation is
 * stale, so no spurious retry loops and no downstream job is created.
 */
export function createIngestAttemptRunner(deps: IngestRunnerDeps): IngestAttemptRunner {
  const loadContext = deps.loadContext ?? defaultLoadContext;
  const applyFinalIdentityFn = deps.applyFinalIdentityFn ?? applyFinalIdentity;
  const saveFn = deps.saveFn ?? saveIncrementalArticle;

  return async (candidate: CandidateIngestRow, ctx): Promise<IngestAttemptResult> => {
    const now = deps.now?.() ?? new Date();

    const context = await loadContext(candidate.id);
    if (!context) return { ok: true }; // candidate vanished — nothing to ingest
    const { candidate: row, source } = context;

    // Belt-and-suspenders governing-invariant re-check (the handler already
    // guards): a known/baseline identity is never re-ingested.
    if (row.articleId != null || row.observedInBaseline) return { ok: true };

    const sourceGeneration = source
      ? {
          definitionVersion: source.definitionVersion,
          activatedAt: source.activatedAt,
          activationGeneration: source.activationGeneration,
        }
      : null;

    const prepared = await deps.prepareDraft({ candidate: row, source, logger: ctx.logger, job: ctx.job, now });
    if (prepared.kind === "failure") {
      // Transient/terminal fetch/extract failure — #1093 classifies + schedules.
      return { ok: false, outcome: prepared.outcome };
    }
    if (prepared.kind === "stop") {
      // Deterministic non-saving stop (e.g. trusted outside-window date): no
      // Article, no downstream job, and NOT a retry.
      ctx.logger.info("candidate ingest stopped before save (no Article)", {
        candidateId: row.id,
        reason: prepared.reason,
      });
      return { ok: true };
    }

    // Resolve the trusted final identity (pure resolver + guarded convergence).
    const resolution = await applyFinalIdentityFn({
      candidateId: row.id,
      owningProviderKey: row.providerKey,
      finalUrl: prepared.finalUrl,
      canonicalUrl: prepared.canonicalUrl,
      prose: prepared.prose,
      now,
    });

    if (resolution.action !== "kept" && resolution.action !== "transferred") {
      // known-article-untouched | noop-terminal | routed-to-review: NO Article
      // is created; the candidate is already parked/terminal (and its ingest job
      // cancelled). A deterministic non-saving completion, not a retry.
      ctx.logger.info("candidate ingest resolved to a non-saving outcome", {
        candidateId: row.id,
        action: resolution.action,
      });
      return { ok: true };
    }

    const fingerprint = computeProseFingerprint(prepared.prose);
    const expectedProviderKey =
      resolution.action === "transferred" ? resolution.targetProviderKey : row.providerKey;

    const draft: ArticleDraft = {
      ...prepared.fields,
      sourceUrl: prepared.finalUrl,
      canonicalUrl: prepared.canonicalUrl ?? null,
    };

    const saveResult = await saveFn({
      candidateId: resolution.winnerId,
      expectedProviderKey,
      sourceGeneration,
      draft,
      fingerprint: fingerprint ? { version: fingerprint.version, hash: fingerprint.hash } : null,
      now,
    });

    ctx.logger.info("candidate ingest save outcome", {
      candidateId: resolution.winnerId,
      action: saveResult.action,
      ...(saveResult.action === "revalidation-failed" ? { reason: saveResult.reason } : {}),
    });

    // Every save outcome is a deterministic completion (saved / converged /
    // known / terminal / revalidation-failed) — never a retryable failure. A
    // stale-generation refusal leaves the candidate for a future generation
    // without looping the Job.
    return { ok: true };
  };
}
