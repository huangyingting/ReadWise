/**
 * Force-rescrape ORCHESTRATION (issue #1102, Phase 3.3).
 *
 * The impure conductor for an audited, operator-only refresh of ONE known public
 * Article. It mirrors `ingest-runner.ts`: the fetch → sanitize → extract →
 * quality → safety → canonical work happens OUTSIDE any transaction behind the
 * injected {@link PrepareRescrapeDraft} seam (so the pipeline is fully
 * fake-testable), the pure {@link force-rescrape-policy} owns every decision, and
 * the thin {@link force-rescrape-commit} owns the guarded writes. This module
 * only sequences them:
 *
 *   1. Read the Article (+ its reader-annotation count) BEFORE any write.
 *   2. Pure eligibility pre-flight — a non-public / URL-less / taken-down / missing
 *      target is refused with NO writes.
 *   3. `dryRun` → a metadata-only PREVIEW (current version, annotation gate, would-
 *      proceed) that creates NOTHING.
 *   4. `createPendingRescrape` — materialize the current content as a durable
 *      ACTIVE baseline (once) and CLAIM the per-Article pending lock; a concurrent
 *      force-rescrape is rejected here (AC4).
 *   5. `prepareDraft` (injected, impure, NO tx) — fetch + validate the replacement
 *      into normalized signals. The DEFAULT production seam fails CLOSED (body
 *      fetch/dispatch for force-rescrape is deferred — see the follow-up), so a
 *      real deployment records a controlled failure and retains the old version
 *      until the fetch seam is wired.
 *   6. Pure `decideForceRescrapeActivation` over the signals + the fail-closed
 *      annotation-migration gate.
 *   7. Proceed → `activateRescrape` (atomic swap); refuse → `recordRescrapeFailure`
 *      (retain the old version). Any thrown error releases the pending lock via a
 *      controlled `internal_error` failure so a stuck lock can never wedge future
 *      refreshes.
 *
 * GOVERNING INVARIANT: this path is NEVER reachable from scheduled/normal
 * discovery — it is invoked ONLY by the dedicated capability-gated endpoint with a
 * mandatory reason. It refreshes a KNOWN Article in place; it never deletes or
 * recreates one.
 *
 * PRIVACY: this module passes the versioned readable payload straight from the
 * prepare seam to the content model and back; it writes NO logs and puts NO
 * content, title, or URL into any return value, audit record, or Job payload.
 */
import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

import {
  decideForceRescrapeActivation,
  decideForceRescrapeEligibility,
  decideAnnotationMigrationGate,
  type ForceRescrapeFailureReason,
  type ForceRescrapeIneligibleReason,
  type RescrapeValidationSignals,
} from "./force-rescrape-policy";
import {
  activateRescrape,
  createPendingRescrape,
  recordRescrapeFailure,
  type RescrapeContentPayload,
} from "./force-rescrape-commit";
import { countArticleAnnotations, getActiveVersion, type ForceRescrapeVersionDto } from "./force-rescrape-query";

// ---------------------------------------------------------------------------
// Injected seams (fake-testable; production fetch is deferred)
// ---------------------------------------------------------------------------

/** Inputs the {@link PrepareRescrapeDraft} seam receives (reads-before-tx, impure). */
export type PrepareRescrapeContext = {
  /** The target Article's identity — what to refetch (never its stored content). */
  article: { id: string; sourceUrl: string; canonicalUrl: string | null };
  /** Sanitized operator justification (context only — never logged by the seam). */
  reason: string;
  now: Date;
};

/** Normalized outcome of the impure fetch → sanitize → extract → validate seam. */
export type PreparedRescrape =
  /** Fetched + extracted a replacement; `signals` carry the validation verdicts. */
  | { kind: "prepared"; content: RescrapeContentPayload; signals: RescrapeValidationSignals }
  /** The fetch/extract could not obtain a replacement — retain the old version. */
  | { kind: "fetch-failure"; reason: Extract<ForceRescrapeFailureReason, "fetch_failed"> };

/**
 * The IMPURE fetch → sanitize → extract → quality → safety → canonical seam for a
 * force-rescrape replacement. Injected so the runner is unit-testable without a
 * network, and so the production wiring (SSRF-safe fetch, sanitizer, extractor,
 * quality + safety gates, canonical resolution) lands behind ONE boundary. It
 * MUST NOT open a transaction, mutate the Article, or run AI.
 */
export type PrepareRescrapeDraft = (ctx: PrepareRescrapeContext) => Promise<PreparedRescrape>;

/**
 * The #1103 annotation re-anchoring seam. Its mere PRESENCE opens the
 * annotation-migration gate (so an annotated Article can be activated); #1102
 * NEVER wires one, so the gate fails closed for any annotated Article. #1102 also
 * never CALLS it (activation only MARKS derived outputs for regeneration) — #1103
 * both supplies the migrator and performs the re-anchoring behind this seam.
 */
export type AnnotationMigrator = {
  reanchor(input: { articleId: string; fromVersionId: string | null; toVersionId: string }): Promise<void>;
};

/** Dependencies for {@link requestForceRescrape}. */
export type ForceRescrapeRunnerDeps = {
  /** The impure fetch/validate seam. Defaults to the fail-closed production stub. */
  prepareDraft?: PrepareRescrapeDraft;
  /** The #1103 annotation migrator. Default (unset) ⇒ the gate fails closed. */
  annotationMigrator?: AnnotationMigrator | null;
  /** Injected clock (tests). */
  now?: () => Date;
};

/**
 * Default PRODUCTION prepare seam: fails CLOSED. Force-rescrape body fetch +
 * dispatch is deferred program-wide (same deferral as #1095/#1099 body fetch — a
 * follow-up wires the SSRF-safe fetch + extractor here). Until then a real
 * force-rescrape records a controlled `fetch_failed` and RETAINS the current
 * active version, so the endpoint is safe to ship: it can never overwrite an
 * Article with an unfetched or unvalidated body.
 */
export const defaultPrepareRescrapeDraft: PrepareRescrapeDraft = async () => {
  return { kind: "fetch-failure", reason: "fetch_failed" };
};

// ---------------------------------------------------------------------------
// Article load (reads-before-write)
// ---------------------------------------------------------------------------

/** Article columns the runner reads to materialize the baseline + gate eligibility. */
const ARTICLE_LOAD_SELECT = {
  id: true,
  title: true,
  content: true,
  excerpt: true,
  author: true,
  heroImage: true,
  source: true,
  category: true,
  wordCount: true,
  readingMinutes: true,
  sourceUrl: true,
  canonicalUrl: true,
  publishedAt: true,
  visibility: true,
  takedownState: true,
} satisfies Prisma.ArticleSelect;

type ArticleLoadRow = Prisma.ArticleGetPayload<{ select: typeof ARTICLE_LOAD_SELECT }>;

/** Builds the baseline content payload from the current Article row. */
function baselinePayload(article: ArticleLoadRow): RescrapeContentPayload {
  return {
    content: article.content,
    title: article.title,
    excerpt: article.excerpt,
    author: article.author,
    heroImage: article.heroImage,
    source: article.source,
    category: article.category,
    wordCount: article.wordCount,
    readingMinutes: article.readingMinutes,
    sourceUrl: article.sourceUrl,
    canonicalUrl: article.canonicalUrl,
    publishedAt: article.publishedAt,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Metadata-only dry-run preview of a would-be force-rescrape (no writes). */
export type ForceRescrapePreview = {
  articleId: string;
  /** The current live content version (null before the first force-rescrape). */
  activeVersion: ForceRescrapeVersionDto | null;
  /** Reader annotations that gate activation. */
  annotationCount: number;
  /** Whether a re-anchoring migrator is wired (false in #1102 ⇒ gate fails closed). */
  migratorWired: boolean;
  /** The annotation-migration gate verdict for the current annotation count. */
  annotationGate: ReturnType<typeof decideAnnotationMigrationGate>;
  /** Whether a real (non-dry-run) request would currently be able to activate. */
  wouldActivate: boolean;
  /** Present when the current annotation gate WOULD block activation. */
  blockedReason?: "annotation-migration-required";
};

/** Terminal outcome of {@link requestForceRescrape}. */
export type ForceRescrapeOutcome =
  /** The target is not a valid force-rescrape candidate — nothing was written. */
  | { ok: false; kind: "not-eligible"; reason: ForceRescrapeIneligibleReason }
  /** A concurrent force-rescrape holds the pending lock — rejected cleanly (AC4). */
  | { ok: false; kind: "conflict" }
  /** A metadata-only preview (dryRun) — nothing was written. */
  | { ok: true; kind: "dry-run"; preview: ForceRescrapePreview }
  /** The replacement was validated and ATOMICALLY activated (same Article id). */
  | { ok: true; kind: "activated"; articleId: string; versionId: string; supersededVersionId: string | null }
  /** A controlled failure — the old active version and all reader access are retained. */
  | { ok: true; kind: "failed"; articleId: string; versionId: string; reason: ForceRescrapeFailureReason };

/**
 * Requests an audited force-rescrape of ONE known public Article. See the module
 * doc for the full sequence. Every write path is guarded and idempotent; a
 * failure at any step leaves the current active version intact.
 */
export async function requestForceRescrape(
  input: { articleId: string; reason: string; requestedById?: string | null; dryRun?: boolean },
  deps: ForceRescrapeRunnerDeps = {},
): Promise<ForceRescrapeOutcome> {
  const now = deps.now?.() ?? new Date();
  const prepareDraft = deps.prepareDraft ?? defaultPrepareRescrapeDraft;
  const migratorWired = deps.annotationMigrator != null;
  const { articleId } = input;

  // 1. Read the Article + its annotation count BEFORE any write.
  const article = await prisma.article.findUnique({ where: { id: articleId }, select: ARTICLE_LOAD_SELECT });
  const annotationCount = article ? await countArticleAnnotations(articleId) : 0;

  // 2. Pure eligibility pre-flight (no writes on refusal).
  const eligibility = decideForceRescrapeEligibility({
    exists: article !== null,
    visibility: article?.visibility ?? null,
    hasSourceUrl: Boolean(article?.sourceUrl && article.sourceUrl.length > 0),
    takedownState: article?.takedownState ?? null,
  });
  if (!eligibility.eligible) return { ok: false, kind: "not-eligible", reason: eligibility.reason };
  // `article` and `article.sourceUrl` are guaranteed present past the gate.
  const loaded = article as ArticleLoadRow;
  const sourceUrl = loaded.sourceUrl as string;

  // 3. Dry-run: a metadata-only preview that creates nothing.
  if (input.dryRun) {
    const annotationGate = decideAnnotationMigrationGate({ annotationCount, migratorWired });
    const activeVersion = await getActiveVersion(articleId);
    const preview: ForceRescrapePreview = {
      articleId,
      activeVersion,
      annotationCount,
      migratorWired,
      annotationGate,
      wouldActivate: annotationGate.pass,
      ...(annotationGate.pass ? {} : { blockedReason: "annotation-migration-required" as const }),
    };
    return { ok: true, kind: "dry-run", preview };
  }

  // 4. Materialize the durable baseline + CLAIM the pending lock (AC4 serialization).
  const pending = await createPendingRescrape({
    articleId,
    reason: input.reason,
    requestedById: input.requestedById ?? null,
    baseline: baselinePayload(loaded),
    now,
  });
  if (!pending.ok) return { ok: false, kind: "conflict" };
  const versionId = pending.pendingVersionId;

  // Steps 5–7 run under a controlled boundary: ANY thrown error releases the
  // pending lock via an `internal_error` controlled failure (never a stuck lock).
  try {
    // 5. Impure fetch + validate (NO transaction). Default seam fails closed.
    const prepared = await prepareDraft({
      article: { id: articleId, sourceUrl, canonicalUrl: loaded.canonicalUrl },
      reason: input.reason,
      now,
    });
    if (prepared.kind === "fetch-failure") {
      await recordRescrapeFailure({ articleId, versionId, reason: prepared.reason, now });
      return { ok: true, kind: "failed", articleId, versionId, reason: prepared.reason };
    }

    // 6. Pure activation gate (signals + fail-closed annotation-migration gate).
    const decision = decideForceRescrapeActivation({
      signals: prepared.signals,
      annotation: { annotationCount, migratorWired },
    });
    if (!decision.proceed) {
      await recordRescrapeFailure({ articleId, versionId, reason: decision.reason, now });
      return { ok: true, kind: "failed", articleId, versionId, reason: decision.reason };
    }

    // 7. Atomic swap. A lost activation guard is treated as a controlled failure.
    const activated = await activateRescrape({
      articleId,
      pendingVersionId: versionId,
      content: prepared.content,
      now,
    });
    if (!activated.ok) {
      await recordRescrapeFailure({ articleId, versionId, reason: "internal_error", now });
      return { ok: true, kind: "failed", articleId, versionId, reason: "internal_error" };
    }
    return {
      ok: true,
      kind: "activated",
      articleId,
      versionId,
      supersededVersionId: activated.supersededVersionId,
    };
  } catch (error) {
    // Release the pending lock so a later force-rescrape is never wedged, then
    // surface the controlled failure. If the release itself fails, rethrow.
    await recordRescrapeFailure({ articleId, versionId, reason: "internal_error", now });
    if (error instanceof Error) {
      return { ok: true, kind: "failed", articleId, versionId, reason: "internal_error" };
    }
    throw error;
  }
}
