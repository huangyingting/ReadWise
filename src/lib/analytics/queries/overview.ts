/**
 * Pure funnel / activation / reading-completion / study-conversion / feature-
 * usage computation. Operates on already-loaded event rows — no Prisma imports.
 */
import { ANALYTICS_EVENT_TYPES } from "@/lib/analytics/events";
import { percentage as pct } from "@/lib/aggregation";

const T = ANALYTICS_EVENT_TYPES;

/** The ordered funnel stages: onboarding → read → save → quiz → study return. */
export const FUNNEL_STAGES: readonly { key: string; label: string }[] = [
  { key: T.onboardingComplete, label: "Onboarding complete" },
  { key: T.articleView, label: "Read an article" },
  { key: T.saveWord, label: "Saved a word" },
  { key: T.quizComplete, label: "Completed a quiz" },
  { key: T.studyReview, label: "Returned to study" },
];

/** Human labels for the feature-usage breakdown. */
const FEATURE_LABELS: Record<string, string> = {
  [T.onboardingStart]: "Onboarding started",
  [T.onboardingComplete]: "Onboarding complete",
  [T.articleView]: "Article views",
  [T.progressComplete]: "Reading completions",
  [T.lookup]: "Word lookups",
  [T.saveWord]: "Words saved",
  [T.quizStart]: "Quizzes started",
  [T.quizComplete]: "Quizzes completed",
  [T.translationUse]: "Translations used",
  [T.tutorUse]: "Tutor used",
  [T.offlineSave]: "Offline saves",
  [T.import]: "Imports",
  [T.studyReview]: "Study reviews",
};

/** One (type, user) aggregate row — the unit the pure functions consume. */
export type EventUserStat = {
  type: string;
  userId: string | null;
  count: number;
};

export type FunnelStage = {
  key: string;
  label: string;
  /** Cumulative distinct users who reached this AND every prior stage. */
  users: number;
  /** Conversion (%) from the previous stage (100 for the first stage). */
  conversionFromPrevPct: number;
  /** Conversion (%) from the first stage. */
  conversionFromStartPct: number;
};

export type RatioMetric = {
  numerator: number;
  denominator: number;
  ratePct: number;
};

export type FeatureUsage = {
  type: string;
  label: string;
  users: number;
  events: number;
};

export type AnalyticsOverview = {
  funnel: FunnelStage[];
  /** Onboarded users who went on to read an article. */
  activation: RatioMetric;
  /** Article readers who reached completion. */
  readingCompletion: RatioMetric;
  /** Word savers who returned to study/review. */
  studyConversion: RatioMetric;
  featureUsage: FeatureUsage[];
  totals: { events: number; users: number };
};

/** Builds a `type -> Set<userId>` map of DISTINCT (non-null) users per type. */
function usersByType(stats: EventUserStat[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const s of stats) {
    if (!s.userId) continue;
    let set = map.get(s.type);
    if (!set) {
      set = new Set<string>();
      map.set(s.type, set);
    }
    set.add(s.userId);
  }
  return map;
}

function intersectionSize(a: Set<string>, b: Set<string> | undefined): Set<string> {
  const out = new Set<string>();
  if (!b) return out;
  for (const id of a) if (b.has(id)) out.add(id);
  return out;
}

/**
 * Computes the full overview (funnel + activation + completion + study
 * conversion + feature usage) from already-loaded (type, user) aggregate rows.
 * Pure + deterministic — the unit tests feed it synthetic events.
 *
 * The funnel is a strict descending funnel: each stage counts users who have
 * performed that stage's action AND every prior stage's action.
 */
export function computeOverview(stats: EventUserStat[]): AnalyticsOverview {
  const byType = usersByType(stats);

  // --- Funnel: cumulative intersection across the ordered stages ----------
  const funnel: FunnelStage[] = [];
  let cumulative: Set<string> | null = null;
  let firstCount = 0;
  for (let i = 0; i < FUNNEL_STAGES.length; i++) {
    const stage = FUNNEL_STAGES[i];
    const stageUsers = byType.get(stage.key) ?? new Set<string>();
    cumulative =
      cumulative === null ? new Set(stageUsers) : intersectionSize(cumulative, stageUsers);
    const users = cumulative.size;
    if (i === 0) firstCount = users;
    const prev = funnel[i - 1]?.users ?? users;
    funnel.push({
      key: stage.key,
      label: stage.label,
      users,
      conversionFromPrevPct: i === 0 ? 100 : pct(users, prev),
      conversionFromStartPct: pct(users, firstCount || users || 1),
    });
  }

  // --- Activation: onboarded users who read an article --------------------
  const onboarded = byType.get(T.onboardingComplete) ?? new Set<string>();
  const readers = byType.get(T.articleView) ?? new Set<string>();
  const activatedUsers = intersectionSize(onboarded, readers);
  const activation: RatioMetric = {
    numerator: activatedUsers.size,
    denominator: onboarded.size,
    ratePct: pct(activatedUsers.size, onboarded.size),
  };

  // --- Reading completion: readers who reached completion -----------------
  const completers = byType.get(T.progressComplete) ?? new Set<string>();
  const completedReaders = intersectionSize(readers, completers);
  const readingCompletion: RatioMetric = {
    numerator: completedReaders.size,
    denominator: readers.size,
    ratePct: pct(completedReaders.size, readers.size),
  };

  // --- Study conversion: savers who returned to review --------------------
  const savers = byType.get(T.saveWord) ?? new Set<string>();
  const reviewers = byType.get(T.studyReview) ?? new Set<string>();
  const convertedSavers = intersectionSize(savers, reviewers);
  const studyConversion: RatioMetric = {
    numerator: convertedSavers.size,
    denominator: savers.size,
    ratePct: pct(convertedSavers.size, savers.size),
  };

  // --- Feature usage: distinct users + total events per type --------------
  const eventsByType = new Map<string, number>();
  for (const s of stats) {
    eventsByType.set(s.type, (eventsByType.get(s.type) ?? 0) + s.count);
  }
  const featureUsage: FeatureUsage[] = [...eventsByType.entries()]
    .map(([type, events]) => ({
      type,
      label: FEATURE_LABELS[type] ?? type,
      users: (byType.get(type) ?? new Set()).size,
      events,
    }))
    .sort((a, b) => b.events - a.events);

  const allUsers = new Set<string>();
  for (const set of byType.values()) for (const id of set) allUsers.add(id);
  const totalEvents = [...eventsByType.values()].reduce((sum, n) => sum + n, 0);

  return {
    funnel,
    activation,
    readingCompletion,
    studyConversion,
    featureUsage,
    totals: { events: totalEvents, users: allUsers.size },
  };
}
