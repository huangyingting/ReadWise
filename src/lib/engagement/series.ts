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
import {
  type DomainResult,
  ok,
  notFound,
  conflict,
  validationError,
} from "@/lib/result";

// ---------------------------------------------------------------------------
// Controlled value sets
// ---------------------------------------------------------------------------

/** Lifecycle of a `ReadingSeries`. `draft/archived` are hidden from learners. */
export const SERIES_STATUSES = ["draft", "active", "archived"] as const;
export type SeriesStatus = (typeof SERIES_STATUSES)[number];

const SERIES_STATUS_SET = new Set<SeriesStatus>(SERIES_STATUSES);
const SERIES_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SERIES_SLUG_MAX = 120;
const SERIES_TITLE_MAX = 200;
const SERIES_DESCRIPTION_MAX = 2000;
const SERIES_TOPIC_MAX = 120;
const SERIES_LEVEL_MAX = 16;

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

/** Admin-safe list row for curated series management. */
export interface AdminSeriesRow {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  topic: string | null;
  targetLevelMin: string | null;
  targetLevelMax: string | null;
  status: SeriesStatus;
  public: boolean;
  articleCount: number;
  createdAt: Date;
  updatedAt: Date;
}

/** Admin-safe detail row for single-series inspection/editing. */
export interface AdminSeriesDetail extends AdminSeriesRow {
  articleIds: string[];
}

/**
 * A resolved series article for admin display: PUBLIC library metadata only
 * (`id`, `title`, `slug`) — never body text, notes, or learner content. `slug`
 * is nullable because `Article.slug` is optional.
 */
export interface SeriesArticleRef {
  id: string;
  title: string;
  slug: string | null;
}

/**
 * Admin series detail enriched with the RESOLVED, order-preserving article
 * metadata for its `articleIds`. `articles` may be SHORTER than `articleIds`
 * when ids are orphaned (ids are NOT foreign keys — orphans are expected and
 * silently omitted from `articles` while remaining in `articleIds`).
 */
export interface AdminSeriesDetailWithArticles extends AdminSeriesDetail {
  articles: SeriesArticleRef[];
}

type OptionalText = string | null | undefined;

export interface CreateReadingSeriesInput {
  slug: string;
  title: string;
  description?: OptionalText;
  topic?: OptionalText;
  targetLevelMin?: OptionalText;
  targetLevelMax?: OptionalText;
  articleIds?: string[];
  public?: boolean;
  status?: SeriesStatus;
}

export interface UpdateReadingSeriesInput {
  slug?: string;
  title?: string;
  description?: OptionalText;
  topic?: OptionalText;
  targetLevelMin?: OptionalText;
  targetLevelMax?: OptionalText;
  articleIds?: string[];
  public?: boolean;
  status?: SeriesStatus;
}

export type ReadingSeriesMutationResult = DomainResult<{ series: AdminSeriesDetail }>;
export type DeleteReadingSeriesResult = DomainResult;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Coerce a Prisma `Json` `articleIds` value into a clean `string[]`. */
function toArticleIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of value) {
    if (typeof raw !== "string") continue;
    const id = raw.trim();
    if (id.length === 0 || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * Re-orders resolved article rows to match the requested `ids`, silently
 * dropping ids with no matching row (orphans). PURE — no DB access.
 */
export function orderSeriesArticles(
  ids: string[],
  rows: SeriesArticleRef[],
): SeriesArticleRef[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const out: SeriesArticleRef[] = [];
  for (const id of ids) {
    const row = byId.get(id);
    if (row) out.push(row);
  }
  return out;
}

/**
 * Resolves a series' `articleIds` to order-preserving PUBLIC metadata
 * (`id`, `title`, `slug`), silently skipping orphaned ids. Article ids are NOT
 * foreign keys, so a missing row is expected — never an error. Reads title/slug
 * only; never article body text or other private content.
 */
export async function resolveSeriesArticles(
  articleIds: string[],
): Promise<SeriesArticleRef[]> {
  const ids = toArticleIds(articleIds);
  if (ids.length === 0) return [];
  const rows = await prisma.article.findMany({
    where: { id: { in: ids } },
    select: { id: true, title: true, slug: true },
  });
  return orderSeriesArticles(ids, rows);
}

function toSeriesStatus(status: string): SeriesStatus {
  return SERIES_STATUS_SET.has(status as SeriesStatus)
    ? (status as SeriesStatus)
    : "draft";
}

type SeriesRowLike = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  topic: string | null;
  targetLevelMin: string | null;
  targetLevelMax: string | null;
  articleIds: unknown;
  status: string;
  public: boolean;
  createdAt: Date;
  updatedAt: Date;
};

function toAdminSeriesDetail(row: SeriesRowLike): AdminSeriesDetail {
  const articleIds = toArticleIds(row.articleIds);
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    topic: row.topic,
    targetLevelMin: row.targetLevelMin,
    targetLevelMax: row.targetLevelMax,
    status: toSeriesStatus(row.status),
    public: row.public,
    articleIds,
    articleCount: articleIds.length,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toAdminSeriesRow(row: SeriesRowLike): AdminSeriesRow {
  const detail = toAdminSeriesDetail(row);
  return {
    id: detail.id,
    slug: detail.slug,
    title: detail.title,
    description: detail.description,
    topic: detail.topic,
    targetLevelMin: detail.targetLevelMin,
    targetLevelMax: detail.targetLevelMax,
    status: detail.status,
    public: detail.public,
    articleCount: detail.articleCount,
    createdAt: detail.createdAt,
    updatedAt: detail.updatedAt,
  };
}

function normalizeOptionalText(
  value: OptionalText,
  field: string,
  max: number,
): DomainResult<{ value: string | null }> {
  if (value === undefined || value === null) return ok({ value: null });
  const normalized = value.trim();
  if (normalized.length === 0) return ok({ value: null });
  if (normalized.length > max) {
    return validationError(`${field} must be at most ${max} characters`);
  }
  return ok({ value: normalized });
}

function normalizeRequiredText(
  value: string,
  field: string,
  max: number,
): DomainResult<{ value: string }> {
  const normalized = value.trim();
  if (normalized.length === 0) {
    return validationError(`${field} is required`);
  }
  if (normalized.length > max) {
    return validationError(`${field} must be at most ${max} characters`);
  }
  return ok({ value: normalized });
}

function normalizeSlug(slug: string): DomainResult<{ value: string }> {
  const required = normalizeRequiredText(slug, "slug", SERIES_SLUG_MAX);
  if (!required.ok) return required;
  const value = required.value.toLowerCase();
  if (!SERIES_SLUG_RE.test(value)) {
    return validationError(
      "slug must contain only lowercase letters, numbers, and single hyphens between segments",
    );
  }
  return ok({ value });
}

function canTransitionSeriesStatus(from: SeriesStatus, to: SeriesStatus): boolean {
  if (from === to) return true;
  if (from === "draft") return to === "active";
  if (from === "active") return to === "archived";
  return false;
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

function isLearnerVisibleSeries(series: {
  status: string;
  public: boolean;
}): boolean {
  return series.status === "active" && series.public === true;
}

async function advanceEnrollmentToIndex(
  enrollmentId: string,
  nextIndex: number,
): Promise<void> {
  await prisma.seriesEnrollment.update({
    where: { id: enrollmentId },
    data: { nextIndex },
  });
}

async function completeEnrollment(
  enrollmentId: string,
  nextIndex: number,
  completedAt: Date = new Date(),
): Promise<void> {
  await prisma.seriesEnrollment.update({
    where: { id: enrollmentId },
    data: { nextIndex, status: "completed", completedAt },
  });
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
  const bySeries = new Map(enrollments.map((e) => [e.seriesId, e]));

  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    title: r.title,
    description: r.description,
    topic: r.topic,
    targetLevelMin: r.targetLevelMin,
    targetLevelMax: r.targetLevelMax,
    articleCount: toArticleIds(r.articleIds).length,
    enrollment: toEnrollmentSummary(bySeries.get(r.id) ?? null),
  }));
}

// ---------------------------------------------------------------------------
// Admin curation (typed service seam for /api/admin/series*)
// ---------------------------------------------------------------------------

/** Lists ALL curated series for admin curation, newest edits first. */
export async function listSeriesForAdmin(): Promise<AdminSeriesRow[]> {
  const rows = await prisma.readingSeries.findMany({
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }, { id: "asc" }],
  });
  return rows.map(toAdminSeriesRow);
}

/** Fetches one curated series for admin detail/editing, or null when missing. */
export async function getSeriesForAdmin(
  seriesId: string,
): Promise<AdminSeriesDetailWithArticles | null> {
  const row = await prisma.readingSeries.findUnique({ where: { id: seriesId } });
  if (!row) return null;
  const detail = toAdminSeriesDetail(row);
  const articles = await resolveSeriesArticles(detail.articleIds);
  return { ...detail, articles };
}

/** Creates a new curated series. Lifecycle starts at `draft` only. */
export async function createReadingSeries(
  input: CreateReadingSeriesInput,
): Promise<ReadingSeriesMutationResult> {
  const slug = normalizeSlug(input.slug);
  if (!slug.ok) return slug;

  const title = normalizeRequiredText(input.title, "title", SERIES_TITLE_MAX);
  if (!title.ok) return title;

  const description = normalizeOptionalText(
    input.description,
    "description",
    SERIES_DESCRIPTION_MAX,
  );
  if (!description.ok) return description;

  const topic = normalizeOptionalText(input.topic, "topic", SERIES_TOPIC_MAX);
  if (!topic.ok) return topic;

  const targetLevelMin = normalizeOptionalText(
    input.targetLevelMin,
    "targetLevelMin",
    SERIES_LEVEL_MAX,
  );
  if (!targetLevelMin.ok) return targetLevelMin;

  const targetLevelMax = normalizeOptionalText(
    input.targetLevelMax,
    "targetLevelMax",
    SERIES_LEVEL_MAX,
  );
  if (!targetLevelMax.ok) return targetLevelMax;

  if (input.status !== undefined && input.status !== "draft") {
    return validationError("status must be draft on create");
  }

  const slugTaken = await prisma.readingSeries.findUnique({
    where: { slug: slug.value },
    select: { id: true },
  });
  if (slugTaken) return conflict("slug already exists");

  const created = await prisma.readingSeries.create({
    data: {
      slug: slug.value,
      title: title.value,
      description: description.value,
      topic: topic.value,
      targetLevelMin: targetLevelMin.value,
      targetLevelMax: targetLevelMax.value,
      articleIds: toArticleIds(input.articleIds ?? []),
      status: "draft",
      public: input.public ?? false,
    },
  });

  return ok({ series: toAdminSeriesDetail(created) });
}

/** Updates curated series metadata, lifecycle state, and article membership. */
export async function updateReadingSeries(
  seriesId: string,
  input: UpdateReadingSeriesInput,
): Promise<ReadingSeriesMutationResult> {
  const existing = await prisma.readingSeries.findUnique({ where: { id: seriesId } });
  if (!existing) return notFound("Series not found");

  const data: {
    slug?: string;
    title?: string;
    description?: string | null;
    topic?: string | null;
    targetLevelMin?: string | null;
    targetLevelMax?: string | null;
    articleIds?: string[];
    status?: SeriesStatus;
    public?: boolean;
  } = {};

  if (input.slug !== undefined) {
    const slug = normalizeSlug(input.slug);
    if (!slug.ok) return slug;
    if (slug.value !== existing.slug) {
      const clash = await prisma.readingSeries.findUnique({
        where: { slug: slug.value },
        select: { id: true },
      });
      if (clash && clash.id !== existing.id) return conflict("slug already exists");
    }
    data.slug = slug.value;
  }

  if (input.title !== undefined) {
    const title = normalizeRequiredText(input.title, "title", SERIES_TITLE_MAX);
    if (!title.ok) return title;
    data.title = title.value;
  }

  if (input.description !== undefined) {
    const description = normalizeOptionalText(
      input.description,
      "description",
      SERIES_DESCRIPTION_MAX,
    );
    if (!description.ok) return description;
    data.description = description.value;
  }

  if (input.topic !== undefined) {
    const topic = normalizeOptionalText(input.topic, "topic", SERIES_TOPIC_MAX);
    if (!topic.ok) return topic;
    data.topic = topic.value;
  }

  if (input.targetLevelMin !== undefined) {
    const targetLevelMin = normalizeOptionalText(
      input.targetLevelMin,
      "targetLevelMin",
      SERIES_LEVEL_MAX,
    );
    if (!targetLevelMin.ok) return targetLevelMin;
    data.targetLevelMin = targetLevelMin.value;
  }

  if (input.targetLevelMax !== undefined) {
    const targetLevelMax = normalizeOptionalText(
      input.targetLevelMax,
      "targetLevelMax",
      SERIES_LEVEL_MAX,
    );
    if (!targetLevelMax.ok) return targetLevelMax;
    data.targetLevelMax = targetLevelMax.value;
  }

  if (input.articleIds !== undefined) {
    data.articleIds = toArticleIds(input.articleIds);
  }

  if (input.public !== undefined) {
    data.public = input.public;
  }

  if (input.status !== undefined) {
    const current = toSeriesStatus(existing.status);
    const next = toSeriesStatus(input.status);
    if (!canTransitionSeriesStatus(current, next)) {
      return conflict(`Cannot transition series status from ${current} to ${next}`);
    }
    data.status = next;
  }

  if (Object.keys(data).length === 0) {
    return validationError("At least one updatable field is required");
  }

  const updated = await prisma.readingSeries.update({
    where: { id: seriesId },
    data,
  });

  return ok({ series: toAdminSeriesDetail(updated) });
}

/** Hard-delete a series when there are no active enrollments. */
export async function deleteReadingSeries(seriesId: string): Promise<DeleteReadingSeriesResult> {
  const existing = await prisma.readingSeries.findUnique({
    where: { id: seriesId },
    select: { id: true },
  });
  if (!existing) return notFound("Series not found");

  const activeEnrollments = await prisma.seriesEnrollment.count({
    where: { seriesId, status: "active" },
  });
  if (activeEnrollments > 0) {
    return conflict("Cannot delete a series with active enrollments");
  }

  await prisma.readingSeries.delete({ where: { id: seriesId } });
  return ok();
}

function hasSameArticleMembership(current: string[], requested: string[]): boolean {
  if (current.length !== requested.length) return false;
  const remaining = new Set(current);
  for (const id of requested) {
    if (!remaining.has(id)) return false;
    remaining.delete(id);
  }
  return remaining.size === 0;
}

/**
 * Reorders article ids transactionally. Reorder-only: requested ids must be the
 * same unique set as the existing series membership.
 */
export async function reorderReadingSeriesItems(
  seriesId: string,
  orderedArticleIds: string[],
): Promise<ReadingSeriesMutationResult> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.readingSeries.findUnique({ where: { id: seriesId } });
    if (!existing) return notFound("Series not found");

    const currentIds = toArticleIds(existing.articleIds);
    const requestedIds = toArticleIds(orderedArticleIds);
    if (!hasSameArticleMembership(currentIds, requestedIds)) {
      return validationError(
        "articleIds must contain each existing series article id exactly once",
      );
    }

    const unchanged = requestedIds.every((id, index) => id === currentIds[index]);
    if (unchanged) {
      return ok({ series: toAdminSeriesDetail(existing) });
    }

    const updated = await tx.readingSeries.update({
      where: { id: seriesId },
      data: { articleIds: requestedIds },
    });
    return ok({ series: toAdminSeriesDetail(updated) });
  });
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
  if (!isLearnerVisibleSeries(enrollment.series)) {
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
        await advanceEnrollmentToIndex(enrollment.id, i);
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
  await completeEnrollment(enrollment.id, ids.length);
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

  if (completed) {
    await completeEnrollment(resolved.enrollmentId, next, now);
  } else {
    await advanceEnrollmentToIndex(resolved.enrollmentId, next);
  }
}
