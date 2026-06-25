/**
 * Controlled backfill & rebuild orchestration (RW-018).
 * Part of the content-processing subsystem (REF-025).
 *
 * As prompts, models, schemas, and enrichment logic evolve, derived content
 * (difficulty, tags, vocabulary, quiz, translation, speech, grammar) needs to be
 * (re)generated WITHOUT overwhelming the AI provider. This module turns an
 * operator request into a set of controlled background JOBS on the persistent
 * `Job` queue, so the existing rate-limited worker drains them at a safe pace.
 *
 * Guarantees:
 *   - DRY-RUN. {@link runBackfill} with `dryRun` reports exactly what WOULD be
 *     enqueued and enqueues / clears nothing.
 *   - RATE CONTROL. The plan is capped at `batchCap` jobs (default
 *     {@link DEFAULT_BACKFILL_BATCH_CAP}); the candidate scan is bounded by
 *     {@link MAX_BACKFILL_SCAN}. The expensive AI work happens later in the
 *     worker, where per-feature AI budgets + rate limits are already enforced
 *     (background context) — backfill only caps how much it enqueues.
 *   - IDEMPOTENT. Each unit of work is one (article, feature) pair with a stable
 *     `dedupeKey` (`backfill:<feature>:<articleId>`), so re-running never
 *     double-enqueues an article+feature that already has an active job.
 *   - AUDITABLE. The rebuild `reason` + operator id are stored in the job
 *     payload (and the caller audits the trigger).
 *   - SAFE. Rebuilds clear DERIVED caches only; user-owned study data
 *     (SavedWord, reading progress) is never touched.
 *
 * Two modes:
 *   - "missing": enqueue work only for features an article is actually missing
 *     (the common backfill). Nothing is cleared.
 *   - "rebuild": force a rebuild — clear the requested derived caches now (cheap
 *     DB deletes, capped) so the worker regenerates them via the cache-first
 *     `getOrCreate*` helpers. Grammar is generated on-demand per phrase, so a
 *     grammar rebuild just clears the cached explanations (they regenerate the
 *     next time a reader asks); the enqueued job is a cheap no-op for it.
 */
import { prisma } from "@/lib/prisma";
import { JobType, enqueueJob, ACTIVE_STATUSES } from "@/lib/jobs";
import { FEATURE_KEYS, FEATURE_REGISTRY, isFeatureKey, type FeatureKey } from "./registry";

/** Canonical set of features supported for backfill/rebuild. Derived from the registry. */
export const BACKFILL_FEATURES = FEATURE_KEYS;
export type BackfillFeature = FeatureKey;

export type BackfillMode = "missing" | "rebuild";

/** Default number of jobs enqueued by a single backfill run. */
export const DEFAULT_BACKFILL_BATCH_CAP = 50;
/** Hard ceiling on a single backfill run, regardless of the requested cap. */
export const MAX_BACKFILL_BATCH_CAP = 500;
/** Max candidate articles scanned per run (operator re-runs to continue). */
export const MAX_BACKFILL_SCAN = 1000;

/**
 * Type guard for backfill feature keys.
 * Alias for {@link isFeatureKey} from the registry; preserved for backward compat.
 */
export function isBackfillFeature(value: string): value is BackfillFeature {
  return isFeatureKey(value);
}

export type BackfillFilter = {
  status?: string;
  category?: string;
  articleIds?: string[];
};

export type BackfillOptions = {
  features: BackfillFeature[];
  mode?: BackfillMode;
  reason: string;
  operatorId?: string | null;
  dryRun?: boolean;
  batchCap?: number;
  filter?: BackfillFilter;
  /** Target languages for the `translation` feature. */
  translateLangs?: string[];
  deps?: Partial<BackfillDeps>;
};

export type BackfillPlanItem = {
  articleId: string;
  /** Step key: a feature name, or "translation:<lang>". */
  feature: string;
  dedupeKey: string;
};

export type BackfillResult = {
  dryRun: boolean;
  mode: BackfillMode;
  features: string[];
  reason: string;
  /** Candidate articles examined. */
  scanned: number;
  /** Total (article, feature) work units before the cap was applied. */
  matched: number;
  /** The cap that was applied. */
  cap: number;
  /** Jobs actually enqueued (0 for dry-run). */
  enqueued: number;
  /** Plan items skipped because an active job already covers them. */
  skippedExisting: number;
  /** Articles whose derived caches were cleared (rebuild mode, non-dry-run). */
  cleared: number;
  jobIds: string[];
  plan: BackfillPlanItem[];
};

export type CandidateArticle = {
  id: string;
  difficulty: string | null;
  translations: { targetLang: string }[];
  speech: { articleId: string } | null;
  _count: {
    tags: number;
    vocabulary: number;
    quizQuestions: number;
    grammarExplanations: number;
  };
};

export type BackfillDeps = {
  loadCandidates: (
    filter: BackfillFilter,
    scanLimit: number,
  ) => Promise<CandidateArticle[]>;
  findActiveDedupeKeys: (keys: string[]) => Promise<Set<string>>;
  clearFeatures: (articleId: string, stepKeys: string[]) => Promise<void>;
  enqueue: (
    type: JobType,
    payload: Record<string, unknown>,
    dedupeKey: string,
  ) => Promise<{ id: string }>;
};

// ---------------------------------------------------------------------------
// Default deps (real prisma + jobs). Injectable for DB/network-free tests.
// ---------------------------------------------------------------------------

async function defaultLoadCandidates(
  filter: BackfillFilter,
  scanLimit: number,
): Promise<CandidateArticle[]> {
  const where: Record<string, unknown> = {};
  if (filter.status) where.status = filter.status;
  if (filter.category) where.category = filter.category;
  if (filter.articleIds && filter.articleIds.length > 0) {
    where.id = { in: filter.articleIds };
  }
  return prisma.article.findMany({
    where,
    orderBy: { createdAt: "asc" },
    take: scanLimit,
    select: {
      id: true,
      difficulty: true,
      translations: { select: { targetLang: true } },
      speech: { select: { articleId: true } },
      _count: {
        select: {
          tags: true,
          vocabulary: true,
          quizQuestions: true,
          grammarExplanations: true,
        },
      },
    },
  }) as unknown as Promise<CandidateArticle[]>;
}

async function defaultFindActiveDedupeKeys(keys: string[]): Promise<Set<string>> {
  if (keys.length === 0) return new Set();
  const rows = await prisma.job.findMany({
    where: { dedupeKey: { in: keys }, status: { in: ACTIVE_STATUSES } },
    select: { dedupeKey: true },
  });
  return new Set(
    rows.map((r) => r.dedupeKey).filter((k): k is string => typeof k === "string"),
  );
}

/**
 * Clears the DERIVED caches for the given step keys + resets their processing
 * state, atomically. NEVER touches user-owned study data (SavedWord, reading
 * progress). Used by rebuild mode so the worker regenerates fresh content.
 */
async function defaultClearFeatures(
  articleId: string,
  stepKeys: string[],
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    for (const key of stepKeys) {
      if (key === "difficulty") {
        await tx.article.update({
          where: { id: articleId },
          data: { difficulty: null, difficultyScore: null },
        });
      } else if (key === "tags") {
        await tx.articleTag.deleteMany({ where: { articleId } });
      } else if (key === "vocabulary") {
        await tx.vocabularyItem.deleteMany({ where: { articleId } });
      } else if (key === "quiz") {
        await tx.quizQuestion.deleteMany({ where: { articleId } });
      } else if (key === "speech") {
        await tx.articleSpeech.deleteMany({ where: { articleId } });
      } else if (key === "grammar") {
        await tx.grammarExplanation.deleteMany({ where: { articleId } });
      } else if (key.startsWith("translation:")) {
        const lang = key.slice("translation:".length);
        await tx.translation.deleteMany({ where: { articleId, targetLang: lang } });
      }
    }
    await tx.articleProcessingStep.deleteMany({
      where: { articleId, step: { in: stepKeys } },
    });
  });
}

async function defaultEnqueue(
  type: JobType,
  payload: Record<string, unknown>,
  dedupeKey: string,
): Promise<{ id: string }> {
  // Background priority so a large backfill never starves foreground processing.
  return enqueueJob(type, payload, { dedupeKey, priority: -1 });
}

function resolveDeps(overrides?: Partial<BackfillDeps>): BackfillDeps {
  return {
    loadCandidates: overrides?.loadCandidates ?? defaultLoadCandidates,
    findActiveDedupeKeys: overrides?.findActiveDedupeKeys ?? defaultFindActiveDedupeKeys,
    clearFeatures: overrides?.clearFeatures ?? defaultClearFeatures,
    enqueue: overrides?.enqueue ?? defaultEnqueue,
  };
}

// ---------------------------------------------------------------------------
// Planning — registry-driven
// ---------------------------------------------------------------------------

function dedupeKeyFor(articleId: string, stepKey: string): string {
  return `backfill:${stepKey}:${articleId}`;
}

/**
 * Returns whether the given non-lang feature is missing for a candidate article.
 * Add a new case here when adding a new feature to the registry.
 */
function candidateMissing(key: FeatureKey, article: CandidateArticle): boolean {
  switch (key) {
    case "difficulty":  return article.difficulty == null;
    case "tags":        return article._count.tags === 0;
    case "vocabulary":  return article._count.vocabulary === 0;
    case "quiz":        return article._count.quizQuestions === 0;
    case "grammar":     return article._count.grammarExplanations === 0;
    case "speech":      return !article.speech;
    case "translation": return false; // handled per-lang below
    default:            return false;
  }
}

/** Step keys an article is MISSING among the requested features. */
function missingStepKeys(
  article: CandidateArticle,
  features: BackfillFeature[],
  langs: string[],
): string[] {
  const out: string[] = [];
  for (const key of features) {
    const feature = FEATURE_REGISTRY.find((f) => f.key === key);
    if (!feature) continue;
    if (feature.supportsLangs) {
      const have = new Set(article.translations.map((t) => t.targetLang));
      for (const lang of langs) if (!have.has(lang)) out.push(`translation:${lang}`);
    } else if (candidateMissing(key, article)) {
      out.push(key);
    }
  }
  return out;
}

/** All requested step keys regardless of existing content (rebuild mode). */
function allStepKeys(features: BackfillFeature[], langs: string[]): string[] {
  const out: string[] = [];
  for (const key of features) {
    const feature = FEATURE_REGISTRY.find((f) => f.key === key);
    if (!feature) continue;
    if (feature.supportsLangs) {
      for (const lang of langs) out.push(`translation:${lang}`);
    } else {
      out.push(key);
    }
  }
  return out;
}

function jobTypeFor(mode: BackfillMode): JobType {
  return mode === "rebuild" ? JobType.AI_REBUILD : JobType.ARTICLE_PROCESS;
}

function payloadFor(
  articleId: string,
  stepKey: string,
  mode: BackfillMode,
  reason: string,
  operatorId: string | null,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    articleId,
    feature: stepKey,
    mode,
    reason,
    operatorId,
  };
  if (stepKey === "speech") {
    payload.tts = true;
  } else if (stepKey.startsWith("translation:")) {
    payload.translateLangs = [stepKey.slice("translation:".length)];
  }
  return payload;
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export class BackfillError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "BackfillError";
    this.status = status;
  }
}

/**
 * Plans and (unless `dryRun`) enqueues a controlled backfill/rebuild. Returns a
 * detailed report so the operator can see what was scanned, matched, capped,
 * skipped (already active), and enqueued.
 */
export async function runBackfill(opts: BackfillOptions): Promise<BackfillResult> {
  const features = Array.from(new Set(opts.features ?? []));
  if (features.length === 0) {
    throw new BackfillError("At least one feature is required");
  }
  for (const f of features) {
    if (!isFeatureKey(f)) {
      throw new BackfillError(`Unknown feature: ${f}`);
    }
  }
  const reason = (opts.reason ?? "").trim();
  if (!reason) {
    throw new BackfillError("A rebuild reason is required");
  }
  const mode: BackfillMode = opts.mode ?? "missing";
  const operatorId = opts.operatorId ?? null;
  const langs = Array.from(new Set((opts.translateLangs ?? []).filter(Boolean)));
  const cap = Math.min(
    MAX_BACKFILL_BATCH_CAP,
    Math.max(1, opts.batchCap ?? DEFAULT_BACKFILL_BATCH_CAP),
  );
  const deps = resolveDeps(opts.deps);

  const candidates = await deps.loadCandidates(opts.filter ?? {}, MAX_BACKFILL_SCAN);

  // Build the full plan (article × feature), then cap it.
  const fullPlan: BackfillPlanItem[] = [];
  for (const article of candidates) {
    const stepKeys =
      mode === "rebuild"
        ? allStepKeys(features, langs)
        : missingStepKeys(article, features, langs);
    for (const stepKey of stepKeys) {
      fullPlan.push({
        articleId: article.id,
        feature: stepKey,
        dedupeKey: dedupeKeyFor(article.id, stepKey),
      });
    }
  }

  const matched = fullPlan.length;
  const plan = fullPlan.slice(0, cap);

  const base: BackfillResult = {
    dryRun: Boolean(opts.dryRun),
    mode,
    features,
    reason,
    scanned: candidates.length,
    matched,
    cap,
    enqueued: 0,
    skippedExisting: 0,
    cleared: 0,
    jobIds: [],
    plan,
  };

  if (opts.dryRun) {
    return base;
  }

  // Skip plan items already covered by an active job (explicit idempotency +
  // fewer writes; the dedupeKey unique constraint is the ultimate guard).
  const activeKeys = await deps.findActiveDedupeKeys(plan.map((p) => p.dedupeKey));
  const toEnqueue = plan.filter((p) => !activeKeys.has(p.dedupeKey));
  base.skippedExisting = plan.length - toEnqueue.length;

  // Rebuild mode: clear the derived caches now (grouped per article), capped to
  // the planned set. Never touches user-owned study data.
  if (mode === "rebuild") {
    const byArticle = new Map<string, string[]>();
    for (const item of toEnqueue) {
      const list = byArticle.get(item.articleId) ?? [];
      list.push(item.feature);
      byArticle.set(item.articleId, list);
    }
    for (const [articleId, stepKeys] of byArticle) {
      await deps.clearFeatures(articleId, stepKeys);
    }
    base.cleared = byArticle.size;
  }

  const jobIds: string[] = [];
  for (const item of toEnqueue) {
    const payload = payloadFor(item.articleId, item.feature, mode, reason, operatorId);
    const job = await deps.enqueue(jobTypeFor(mode), payload, item.dedupeKey);
    jobIds.push(job.id);
  }
  base.enqueued = jobIds.length;
  base.jobIds = jobIds;
  return base;
}
