/**
 * Curated reading series — enrollment + access-checked article resolution (#813).
 *
 * @server-only — imports Prisma and the Article Library access policy.
 *
 * A `ReadingSeries` is a curator-defined, ORDERED list of article ids with a
 * theme and target CEFR range. Learners enroll in a series; Today generation
 * pulls the next article as a SOFT candidate (never a hard override). This
 * module owns:
 *   - listing public/active series with the caller's enrollment state;
 *   - enroll / unenroll commands;
 *   - resolving the next VALID, ACCESSIBLE series article (advancing the
 *     enrollment past deleted/inaccessible ids);
 *   - advancing `nextIndex` when the series article is completed.
 *
 * Access invariant: `articleIds` are NOT foreign keys. Every id is revalidated
 * through {@link getPublicListableArticleById} at serve time — identical to how
 * Today backup ids are revalidated — so a private, unpublished, or deleted
 * series article is silently skipped and NEVER bypasses Article Library
 * visibility/access rules.
 *
 * Privacy: this module reads/writes enrollment position + status + timestamps
 * and series metadata ONLY. It never stores or logs article text, series notes,
 * prompts, per-article WPM, or any learner reading history in series metadata.
 */

import { prisma } from "@/lib/prisma";
import { getPublicListableArticleById } from "@/lib/article-library/policy";
import { recordEvent, ANALYTICS_EVENT_TYPES } from "@/lib/analytics/events";

// ---------------------------------------------------------------------------
// Controlled value sets
// ---------------------------------------------------------------------------

/** Lifecycle of a `ReadingSeries`. `archived` hides it from learners. */
export const SERIES_STATUSES = ["active", "archived"] as const;
export type SeriesStatus = (typeof SERIES_STATUSES)[number];

/** Lifecycle of a `SeriesEnrollment`. */
export const ENROLLMENT_STATUSES = ["active", "paused", "completed"] as const;
export type EnrollmentStatus = (typeof ENROLLMENT_STATUSES)[number];

// ---------------------------------------------------------------------------
// Public view types (metadata + counts only — never article content)
// ---------------------------------------------------------------------------

/** Privacy-safe enrollment summary for a series. */
export interface SeriesEnrollmentSummary {
  status: EnrollmentStatus;
  nextIndex: number;
  startedAt: Date;
  completedAt: Date | null;
}

/** Privacy-safe series card for the learner-facing browser. */
export interface SeriesCard {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  topic: string | null;
  targetLevelMin: string | null;
  targetLevelMax: string | null;
  /** Number of article ids defined on the series (NOT their content). */
  articleCount: number;
  /** The caller's enrollment, or null when not enrolled. */
  enrollment: SeriesEnrollmentSummary | null;
}

/** A resolved, access-checked next series article for Today injection. */
export interface ResolvedSeriesArticle {
  seriesId: string;
  enrollmentId: string;
  articleId: string;
  /** The (possibly advanced) index the article was resolved at. */
  index: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Coerce a Prisma `Json` `articleIds` value into a clean `string[]`. */
function toArticleIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.length > 0);
}

function toEnrollmentSummary(
  e: {
    status: string;
    nextIndex: number;
    startedAt: Date;
    completedAt: Date | null;
  } | null,
): SeriesEnrollmentSummary | null {
  if (!e) return null;
  return {
    status: (e.status as EnrollmentStatus) ?? "active",
    nextIndex: e.nextIndex,
    startedAt: e.startedAt,
    completedAt: e.completedAt,
  };
}

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

/**
 * List learner-facing series (`status = "active"` AND `public = true`) with the
 * caller's enrollment state attached. Carries metadata + counts only.
 */
export async function listPublicSeriesForUser(
  userId: string,
): Promise<SeriesCard[]> {
  const rows = await prisma.readingSeries.findMany({
    where: { status: "active", public: true },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      slug: true,
      title: true,
      description: true,
      topic: true,
      targetLevelMin: true,
      targetLevelMax: true,
      articleIds: true,
    },
  });
  if (rows.length === 0) return [];

  const enrollments = await prisma.seriesEnrollment.findMany({
    where: { userId, seriesId: { in: rows.map((r) => r.id) } },
    select: {
      seriesId: true,
      status: true,
      nextIndex: true,
      startedAt: true,
      completedAt: true,
    },
  });
  const byseries = new Map(enrollments.map((e) => [e.seriesId, e]));

  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    title: r.title,
    description: r.description,
    topic: r.topic,
    targetLevelMin: r.targetLevelMin,
    targetLevelMax: r.targetLevelMax,
    articleCount: toArticleIds(r.articleIds).length,
    enrollment: toEnrollmentSummary(byseries.get(r.id) ?? null),
  }));
}

/**
 * Fetch a single learner-facing series by id, or null when it does not exist or
 * is not public (`status = "active"` AND `public = true`). Used by the enroll /
 * unenroll routes to map a hidden/missing series to a 404 (IDOR-safe — existence
 * is never leaked beyond the public set).
 */
export async function getPublicSeries(
  seriesId: string,
): Promise<{ id: string; slug: string } | null> {
  return prisma.readingSeries.findFirst({
    where: { id: seriesId, status: "active", public: true },
    select: { id: true, slug: true },
  });
}

// ---------------------------------------------------------------------------
// Enroll / unenroll
// ---------------------------------------------------------------------------

/** Outcome of an enroll/unenroll command. `notFound` maps to a 404. */
export type SeriesEnrollResult =
  | { ok: true; status: EnrollmentStatus }
  | { ok: false; reason: "not_found" };

/**
 * Enroll the learner in a public series. Idempotent: an existing enrollment is
 * reactivated to `active` (its `nextIndex` is preserved so progress is kept).
 * Returns `not_found` for a missing or non-public series. Emits the
 * `series_enrolled` analytics event (anchors only — id + slug).
 */
export async function enrollInSeries(
  userId: string,
  seriesId: string,
): Promise<SeriesEnrollResult> {
  const series = await getPublicSeries(seriesId);
  if (!series) return { ok: false, reason: "not_found" };

  await prisma.seriesEnrollment.upsert({
    where: { userId_seriesId: { userId, seriesId } },
    create: { userId, seriesId },
    update: { status: "active", completedAt: null },
  });

  await recordEvent({
    type: ANALYTICS_EVENT_TYPES.seriesEnrolled,
    userId,
    properties: { seriesId: series.id, seriesSlug: series.slug },
  });

  return { ok: true, status: "active" };
}

/**
 * Unenroll the learner from a public series by deleting their enrollment row.
 * Idempotent: deleting a non-existent enrollment is a no-op success. Returns
 * `not_found` for a missing or non-public series (so the route surfaces a 404).
 */
export async function unenrollFromSeries(
  userId: string,
  seriesId: string,
): Promise<SeriesEnrollResult> {
  const series = await getPublicSeries(seriesId);
  if (!series) return { ok: false, reason: "not_found" };

  await prisma.seriesEnrollment.deleteMany({ where: { userId, seriesId } });
  return { ok: true, status: "active" };
}

// ---------------------------------------------------------------------------
// Access-checked resolution + advance
// ---------------------------------------------------------------------------

/**
 * Resolve the next VALID, ACCESSIBLE article for the learner's active
 * enrollment (if any), starting at `nextIndex`. Each candidate id is revalidated
 * through {@link getPublicListableArticleById}; ids that are private, deleted, or
 * otherwise inaccessible are skipped and `nextIndex` is persisted forward past
 * them. When no accessible article remains, the enrollment is marked
 * `completed` and `null` is returned.
 *
 * Returns `null` when there is no active enrollment, no series articles, or no
 * remaining accessible article. Side effect: advances `nextIndex` / completes
 * the enrollment — but never beyond a monotonic forward walk.
 */
export async function resolveNextSeriesArticle(
  userId: string,
): Promise<ResolvedSeriesArticle | null> {
  const enrollment = await prisma.seriesEnrollment.findFirst({
    where: { userId, status: "active" },
    orderBy: { startedAt: "desc" },
    select: {
      id: true,
      seriesId: true,
      nextIndex: true,
      series: { select: { id: true, articleIds: true, status: true, public: true } },
    },
  });
  if (!enrollment || !enrollment.series) return null;
  // Series flipped to archived / private after enrollment — stop surfacing it.
  if (enrollment.series.status !== "active" || enrollment.series.public !== true) {
    return null;
  }

  const ids = toArticleIds(enrollment.series.articleIds);
  const start = Math.max(0, enrollment.nextIndex);

  for (let i = start; i < ids.length; i += 1) {
    const article = await getPublicListableArticleById(ids[i], {
      select: { id: true },
    });
    if (article) {
      // Persist any forward skip past inaccessible ids before this one.
      if (i !== enrollment.nextIndex) {
        await prisma.seriesEnrollment.update({
          where: { id: enrollment.id },
          data: { nextIndex: i },
        });
      }
      return {
        seriesId: enrollment.seriesId,
        enrollmentId: enrollment.id,
        articleId: article.id,
        index: i,
      };
    }
  }

  // No accessible article remains — complete the enrollment (idempotent).
  await prisma.seriesEnrollment.update({
    where: { id: enrollment.id },
    data: { nextIndex: ids.length, status: "completed", completedAt: new Date() },
  });
  return null;
}

/**
 * Advance the learner's active enrollment when `completedArticleId` is the
 * series article currently at the resolved `nextIndex`. Monotonic + idempotent:
 *   - re-resolution returns the current accessible series article; only an exact
 *     id match advances `nextIndex` to `index + 1`;
 *   - a second call for the same article no longer matches (the resolver has
 *     moved on), so `nextIndex` never double-advances;
 *   - reaching the end marks the enrollment `completed`.
 *
 * No-op (and never throws) when there is no active enrollment or the completed
 * article is not the current series article.
 */
export async function advanceSeriesOnArticleRead(
  userId: string,
  completedArticleId: string,
  now: Date = new Date(),
): Promise<void> {
  const resolved = await resolveNextSeriesArticle(userId);
  if (!resolved || resolved.articleId !== completedArticleId) return;

  const enrollment = await prisma.seriesEnrollment.findUnique({
    where: { id: resolved.enrollmentId },
    select: { series: { select: { articleIds: true } } },
  });
  const total = toArticleIds(enrollment?.series?.articleIds).length;
  const next = resolved.index + 1;
  const completed = next >= total;

  await prisma.seriesEnrollment.update({
    where: { id: resolved.enrollmentId },
    data: {
      nextIndex: next,
      ...(completed ? { status: "completed", completedAt: now } : {}),
    },
  });
}
