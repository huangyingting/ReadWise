/**
 * Derived-output regeneration after a force-rescrape activation (#1103).
 *
 * Once a validated replacement content version is ATOMICALLY activated, the
 * outputs DERIVED from the old content are stale and must be regenerated — but
 * ONLY the ones whose source basis actually changed, and ONLY as part of the
 * audited force-rescrape (NEVER from ordinary incremental rediscovery). This
 * module invalidates those outputs and enqueues ONE deduplicated rebuild scoped
 * to the exact (Article id + target content-version id), so a worker
 * restart/retry can never double-enqueue or double-regenerate (AC3/AC4).
 *
 * CONTENT-POSITION vs ARTICLE-LEVEL (requirement #1) — the classification is
 * explicit here:
 *
 *   CONTENT-POSITION DEPENDENT (regenerated — their basis is the article text):
 *     - difficulty / lexile fields on Article  (scored from the prose)
 *     - tags                                    (derived from the prose)
 *     - vocabulary items                        (extracted from the prose)
 *     - quiz questions                          (generated from the prose)
 *     - translations (article + sentence cache) (content-hash keyed → stale)
 *     - narration / speech timing               (word offsets into the prose)
 *     - grammar explanations                    (phrases from the prose)
 *   Highlight/note ANCHORS are also content-position dependent, but they are
 *   MIGRATED in place inside the activation transaction (not regenerated) so no
 *   user text is ever recreated — see `annotation-reanchor.ts` / the commit.
 *
 *   ARTICLE-LEVEL (LEFT UNTOUCHED — attached to the Article identity, not its
 *   text): ownership/visibility/status, reading progress, reading-list items,
 *   article mastery, quiz attempts, saved words, audit history, content review,
 *   assignments. Force-rescrape refreshes the Article IN PLACE, so all of these
 *   remain valid and are never cleared or regenerated.
 *
 * MODULE BOUNDARY: `src/lib/scraper/*` may not import `@/lib/processing`, so the
 * feature-step keys are mirrored here as {@link CONTENT_DERIVED_FEATURE_STEPS}
 * (kept deliberately in sync with `processing/registry.ts` `FEATURE_KEYS`). The
 * rebuild is enqueued through the sanctioned `@/lib/jobs` barrel.
 *
 * PRIVACY: every write here carries IDs + language codes + machine status only —
 * never article text, a quote, a note, a prompt, or a translation.
 */
import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { enqueueAiRebuild } from "@/lib/jobs";
import { createLogger } from "@/lib/observability/logger";

const log = createLogger("rescrape-regen");

/**
 * Content-position dependent processing-feature steps whose cached output is
 * cleared so the cache-first processor regenerates them from the NEW content.
 * Mirrors `processing/registry.ts` `FEATURE_KEYS`; duplicated (not imported) to
 * respect the one-way scraper→processing boundary. Per-language translation
 * steps (`translation:<lang>`) are additionally matched by prefix.
 */
export const CONTENT_DERIVED_FEATURE_STEPS = [
  "difficulty",
  "tags",
  "vocabulary",
  "quiz",
  "translation",
  "speech",
  "grammar",
] as const;

/** The per-version processing-step key that makes regeneration at-most-once. */
export function rescrapeRegenStepKey(versionId: string): string {
  return `rescrape-regen:${versionId}`;
}

/**
 * The rebuild Job dedupe key. Scoped to BOTH the Article id AND the target
 * content-version id so a retry/worker-restart converges on the single job for
 * this version and can never double-enqueue (AC3/AC4).
 */
export function rescrapeRegenDedupeKey(articleId: string, versionId: string): string {
  return `rescrape-regen:${articleId}:${versionId}`;
}

/** True when a thrown error is a Prisma unique-constraint (P2002) conflict. */
function isUniqueConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/**
 * Deletes/nulls every content-position derived output for an Article so the
 * cache-first processor regenerates it. Idempotent: re-running on already-cleared
 * data is a harmless no-op. Runs inside the caller's transaction so invalidation
 * is all-or-nothing. Does NOT touch the per-version regeneration claim step
 * (its key is namespaced `rescrape-regen:<versionId>`) or any ARTICLE-LEVEL
 * relationship (reading progress, mastery, ownership, audit, …).
 */
export async function clearContentDerivedOutputs(
  tx: Prisma.TransactionClient,
  articleId: string,
): Promise<void> {
  await tx.translation.deleteMany({ where: { articleId } });
  await tx.sentenceTranslation.deleteMany({ where: { articleId } });
  await tx.vocabularyItem.deleteMany({ where: { articleId } });
  await tx.quizQuestion.deleteMany({ where: { articleId } });
  await tx.articleTag.deleteMany({ where: { articleId } });
  await tx.grammarExplanation.deleteMany({ where: { articleId } });
  await tx.articleSpeech.deleteMany({ where: { articleId } });
  await tx.article.update({
    where: { id: articleId },
    data: {
      difficulty: null,
      difficultyScore: null,
      lexileApprox: null,
      difficultyVersion: null,
    },
  });
  await tx.articleProcessingStep.deleteMany({
    where: {
      articleId,
      OR: [
        { step: { in: [...CONTENT_DERIVED_FEATURE_STEPS] } },
        { step: { startsWith: "translation:" } },
      ],
    },
  });
}

/** Outcome of {@link requestDerivedRegeneration}. */
export type RequestDerivedRegenerationResult = {
  /** True when this call claimed the version and enqueued the rebuild. */
  requested: boolean;
  /** True when a prior call already claimed this version (idempotent no-op). */
  alreadyRequested: boolean;
  /** The languages whose translations were invalidated (re-requested). */
  translateLangs: string[];
};

/**
 * Invalidates + enqueues regeneration of the content-derived outputs for a newly
 * ACTIVE content version. Called OFF the activation (best-effort, retryable — it
 * is NOT part of the activation transaction, per the #1103 "async/retryable"
 * design). At-most-once-per-version is enforced by CLAIMING a per-version
 * {@link ArticleProcessingStep}: the `@@unique([articleId, step])` constraint
 * makes a concurrent/retried claim fail closed (`alreadyRequested`), so a worker
 * restart never re-clears or double-enqueues (AC3/AC4). The rebuild itself runs
 * asynchronously in the article handler, where optional AI/narration providers
 * degrade gracefully (requirement #5) — activation never blocks on them.
 */
export async function requestDerivedRegeneration(input: {
  articleId: string;
  versionId: string;
  now?: Date;
}): Promise<RequestDerivedRegenerationResult> {
  const now = input.now ?? new Date();
  const { articleId, versionId } = input;
  const stepKey = rescrapeRegenStepKey(versionId);

  // 1. CLAIM the version (at-most-once). A retry/concurrent call loses the
  //    unique race and is a safe no-op — no re-clear, no duplicate job.
  try {
    await prisma.articleProcessingStep.create({
      data: {
        articleId,
        step: stepKey,
        status: "running",
        attempts: 1,
        startedAt: now,
        createdAt: now,
        updatedAt: now,
      },
    });
  } catch (error) {
    if (isUniqueConflict(error)) {
      return { requested: false, alreadyRequested: true, translateLangs: [] };
    }
    throw error;
  }

  // 2. Capture the languages to re-translate BEFORE clearing (reads-before-clear).
  const langRows = await prisma.translation.findMany({
    where: { articleId },
    select: { targetLang: true },
  });
  const translateLangs = [...new Set(langRows.map((row) => row.targetLang))].sort();

  // 3. Invalidate the stale content-derived outputs (idempotent, atomic).
  await prisma.$transaction(async (tx) => {
    await clearContentDerivedOutputs(tx, articleId);
  });

  // 4. Enqueue ONE version-scoped rebuild (ids + langs only; tts is soft/optional).
  await enqueueAiRebuild(
    articleId,
    { tts: true, translateLangs },
    { dedupeKey: rescrapeRegenDedupeKey(articleId, versionId) },
  );

  // 5. Mark the claim complete so status/reconciliation can see it landed.
  await prisma.articleProcessingStep.updateMany({
    where: { articleId, step: stepKey },
    data: { status: "generated", completedAt: now, updatedAt: now },
  });

  log.info("derived regeneration enqueued", {
    articleId,
    versionId,
    translateLangCount: translateLangs.length,
  });

  return { requested: true, alreadyRequested: false, translateLangs };
}
