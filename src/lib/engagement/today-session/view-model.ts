/**
 * Today Session — learner-facing view model (#796/#797/#798).
 *
 * @server-only — the loader imports Prisma (via the generator + Article Library
 * id resolution). The pure {@link buildTodayViewModel} mapper has NO I/O and is
 * unit-tested in isolation against fixtures.
 *
 * The view model is the single privacy-safe shape shared by the `/today` page,
 * `GET /api/today`, and the Dashboard Today card. It resolves the day's stable
 * article ids into safe display cards through the Article Library readable
 * where-clause (so a private/imported title is only ever shown after access has
 * been checked), and carries ONLY anchors/ids/statuses/display metadata — never
 * article body text, word text, definitions, examples, prompts, or notes.
 */

import {
  articleAccessContext,
  getReadableArticleById,
  toListingArticle,
  type ArticleCardSource,
  type ListingArticle,
} from "@/lib/article-library";
import { getOrCreateTodaySession } from "./generator";
import { resolveLocalDate } from "./local-date";
import { emitTodaySessionViewed } from "./analytics";
import type {
  TodayCompletionTier,
  TodaySessionSource,
  TodaySessionStatus,
  TodaySessionView,
  TodaySkipReason,
} from "./types";
import { TODAY_REFLECTION_PROMPT } from "./types";

/** Display state of one workflow step. */
export type TodayStepState =
  | "available" // ready to act on now
  | "complete" // finished
  | "unavailable"; // not applicable today (e.g. no target words)

/** The reading / comprehension / word-review step tracker. */
export type TodaySteps = {
  reading: { state: TodayStepState; completedAt: string | null };
  comprehension: { state: TodayStepState; completedAt: string | null };
  wordReview: {
    state: TodayStepState;
    /** True when the day actually has target words to review. */
    available: boolean;
    targetCount: number;
    completedAt: string | null;
  };
};

/** What the primary call-to-action should do. */
export type TodayCtaKind =
  | "start" // begin reading a freshly-picked article
  | "continue" // resume an in-progress article
  | "browse" // no candidate / skipped → go browse or import
  | "completed"; // the day is done

export type TodayCta = {
  kind: TodayCtaKind;
  label: string;
  href: string;
};

/** Step-count progress for the UI. Intentionally NOT a numeric daily score. */
export type TodayProgress = {
  completedSteps: number;
  totalSteps: number;
};

/**
 * OPTIONAL, additive "write one sentence after reading" bonus (#812). It is
 * purely celebratory: it NEVER contributes to {@link TodayProgress}, the step
 * tracker, the CTA, the completion tier, or the session status, so it can never
 * block or alter required Today completion. The reflection text itself is stored
 * in the existing note domain — never in the `TodaySession` row.
 */
export type TodayReflectionBonus = {
  /** True once reading is done, so the bonus is contextually offered. */
  available: boolean;
  /** Display prompt copy (no learning content). */
  label: string;
};

/** Privacy-safe Today view model — anchors, ids, statuses, and safe display. */
export type TodayViewModel = {
  localDate: string;
  timezone: string;
  status: TodaySessionStatus;
  source: TodaySessionSource;
  completionTier: TodayCompletionTier;
  completedAt: string | null;
  skipped: boolean;
  skipReason: TodaySkipReason | null;
  /** True when the session row carries a primary article id at all. */
  hasPrimary: boolean;
  /** True when that primary id still resolves to a readable article. */
  primaryReadable: boolean;
  /** Safe display card for the primary article, or null. */
  primaryArticle: ListingArticle | null;
  /** Safe display cards for the day's still-readable backup articles. */
  backups: ListingArticle[];
  steps: TodaySteps;
  progress: TodayProgress;
  cta: TodayCta;
  /** Optional, additive reflection bonus — never affects required completion. */
  reflectionBonus: TodayReflectionBonus;
  /** True for the no-candidate browse/import prompt state. */
  isNoCandidate: boolean;
  /**
   * Privacy-safe weak-word re-exposure explanation (#808). True when the day's
   * plan includes saved words to review, so the UI can say "reviews words you
   * saved". Carries ONLY a flag + count — never the word text, definitions, or
   * any other learning content.
   */
  reviewsSavedWords: boolean;
  /** How many saved words the day re-exposes (0 when none). Count only. */
  savedWordCount: number;
};

/** Resolved article displays the pure builder needs (already access-checked). */
export type TodayArticleDisplays = {
  primary: ListingArticle | null;
  backups: ListingArticle[];
};

const READER_PATH = "/reader";
const BROWSE_PATH = "/browse";

/**
 * Derive the workflow steps from a session's completion timestamps.
 *
 * Word review is `unavailable` when the day has no target words; otherwise it is
 * `complete`/`available` from `wordReviewCompletedAt`. Reading/comprehension are
 * `complete`/`available` from their own timestamps.
 */
function buildSteps(session: TodaySessionView): TodaySteps {
  const targetCount = session.targetSavedWordIds.length;
  const hasTargets = targetCount > 0;

  const readingComplete = session.readingCompletedAt != null;
  const comprehensionComplete = session.comprehensionCompletedAt != null;
  const wordReviewComplete = session.wordReviewCompletedAt != null;

  return {
    reading: {
      state: readingComplete ? "complete" : "available",
      completedAt: toIso(session.readingCompletedAt),
    },
    comprehension: {
      state: comprehensionComplete ? "complete" : "available",
      completedAt: toIso(session.comprehensionCompletedAt),
    },
    wordReview: {
      state: !hasTargets
        ? "unavailable"
        : wordReviewComplete
          ? "complete"
          : "available",
      available: hasTargets,
      targetCount,
      completedAt: toIso(session.wordReviewCompletedAt),
    },
  };
}

/** Count completed steps out of the steps that actually apply today. */
function buildProgress(steps: TodaySteps): TodayProgress {
  const applicable = [steps.reading, steps.comprehension, steps.wordReview].filter(
    (s) => s.state !== "unavailable",
  );
  const completedSteps = applicable.filter((s) => s.state === "complete").length;
  return { completedSteps, totalSteps: applicable.length };
}

/** Choose the primary CTA from the session state + resolved primary article. */
function buildCta(
  session: TodaySessionView,
  primaryArticle: ListingArticle | null,
): TodayCta {
  if (session.status === "completed") {
    return { kind: "completed", label: "Reading complete", href: READER_PATH };
  }
  if (
    session.status === "skipped" ||
    !session.primaryArticleId ||
    !primaryArticle
  ) {
    return { kind: "browse", label: "Browse articles", href: BROWSE_PATH };
  }
  const href = `${READER_PATH}/${primaryArticle.id}`;
  if (session.source === "resume" || session.readingCompletedAt != null) {
    return { kind: "continue", label: "Continue reading", href };
  }
  return { kind: "start", label: "Start reading", href };
}

/**
 * Pure assembly of the Today view model from a session view + already-resolved,
 * access-checked article displays. No I/O — unit-tested directly.
 */
export function buildTodayViewModel(
  session: TodaySessionView,
  timezone: string,
  displays: TodayArticleDisplays,
): TodayViewModel {
  const steps = buildSteps(session);
  const primaryReadable = displays.primary != null;
  const savedWordCount = session.targetSavedWordIds.length;

  return {
    localDate: session.localDate,
    timezone,
    status: session.status,
    source: session.source,
    completionTier: session.completionTier,
    completedAt: toIso(session.completedAt),
    skipped: session.skipped,
    skipReason: session.skipReason,
    hasPrimary: session.primaryArticleId != null,
    primaryReadable,
    primaryArticle: displays.primary,
    backups: displays.backups,
    steps,
    progress: buildProgress(steps),
    cta: buildCta(session, displays.primary),
    reflectionBonus: {
      // Offered once reading is done — "write one sentence AFTER reading". This
      // is read-only display state; it intentionally does NOT feed steps,
      // progress, the CTA, the completion tier, or the session status.
      available: session.readingCompletedAt != null,
      label: TODAY_REFLECTION_PROMPT,
    },
    isNoCandidate: session.primaryArticleId == null,
    reviewsSavedWords: savedWordCount > 0,
    savedWordCount,
  };
}

/** Article fields selected for safe display — NEVER `content` or other body text. */
const ARTICLE_CARD_SELECT = {
  id: true,
  title: true,
  author: true,
  source: true,
  category: true,
  difficulty: true,
  readingMinutes: true,
  wordCount: true,
  publishedAt: true,
  heroImage: true,
} as const;

/**
 * Resolve a single article id into a safe display card, scoped to what the user
 * may read. Returns null when the id no longer resolves or is inaccessible
 * (stale/private), so a dangling anchor degrades gracefully.
 */
async function resolveReadableCard(
  id: string,
  context: ReturnType<typeof articleAccessContext>,
): Promise<ListingArticle | null> {
  const article = await getReadableArticleById(id, context, {
    select: ARTICLE_CARD_SELECT,
  });
  if (!article) return null;
  return toListingArticle(article as ArticleCardSource);
}

/**
 * Load the privacy-safe Today view model for an authenticated user. Creates or
 * loads the stable session for the learner's local day, then resolves the
 * primary + backup ids into access-checked display cards. The `user` carries
 * only id/role used for visibility checks — never trusted for ownership beyond
 * the Article Library where-clause.
 */
export async function loadTodayViewModel(args: {
  user: { id: string; role?: string | null };
  requestTimezone?: string | null;
  now?: Date;
}): Promise<TodayViewModel> {
  const now = args.now ?? new Date();
  const { localDate, timezone } = await resolveLocalDate({
    userId: args.user.id,
    requestTimezone: args.requestTimezone,
    now,
  });

  const session = await getOrCreateTodaySession({
    userId: args.user.id,
    localDate,
    timezoneSnapshot: timezone,
    now,
  });

  // Product analytics (#802): record a Today view (page render or summary
  // fetch). Best-effort + metadata only (status/source/tier/flags) — never
  // article or word content.
  await emitTodaySessionViewed(session);

  const context = articleAccessContext({
    id: args.user.id,
    role: args.user.role ?? null,
  });

  const [primary, ...backups] = await Promise.all([
    session.primaryArticleId
      ? resolveReadableCard(session.primaryArticleId, context)
      : Promise.resolve(null),
    ...session.backupArticleIds.map((id) => resolveReadableCard(id, context)),
  ]);

  const readableBackups = backups.filter(
    (card): card is ListingArticle => card != null,
  );

  return buildTodayViewModel(session, timezone, {
    primary,
    backups: readableBackups,
  });
}

/** ISO-string a nullable Date for a JSON-safe payload. */
function toIso(d: Date | null): string | null {
  return d ? d.toISOString() : null;
}
