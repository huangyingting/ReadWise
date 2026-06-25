/**
 * Content governance — moderation review workflow and takedown/rights policy
 * (article-library subsystem, REF-040).
 *
 * Combines:
 *   - Content quality review (`reviewArticle`, `listContentReviews`) — an
 *     orthogonal REVIEW axis on articles, with field corrections and an
 *     append-only ContentReview history.
 *   - Content rights & takedown policy (`applyTakedown`) — a RIGHTS/governance
 *     axis recording whether content must be withheld for licensing, robots,
 *     DMCA or other reasons.
 *
 * A non-active takedown state forces a PUBLISHED article to DRAFT so it leaves
 * public feeds. Publishing a taken-down article is refused (409) — rights win
 * over editorial intent.
 */
import { prisma } from "@/lib/prisma";
import { ArticleStatus, type Prisma } from "@prisma/client";
import { isValidCategorySlug } from "@/lib/categories";
import { parseLevel } from "@/lib/difficulty";
import { getArticleTags, setArticleTags } from "@/lib/article-library/collections";

// ---------------------------------------------------------------------------
// Review state
// ---------------------------------------------------------------------------

/** The review verdicts an article can hold. */
export const REVIEW_STATES = [
  "unreviewed",
  "approved",
  "needs_work",
  "rejected",
] as const;

export type ReviewState = (typeof REVIEW_STATES)[number];

export function isReviewState(value: unknown): value is ReviewState {
  return typeof value === "string" && (REVIEW_STATES as readonly string[]).includes(value);
}

/** Human labels for the admin UI. */
export const REVIEW_STATE_LABELS: Record<ReviewState, string> = {
  unreviewed: "Unreviewed",
  approved: "Approved",
  needs_work: "Needs work",
  rejected: "Rejected",
};

/** Suggested quality flags surfaced as quick-toggles in the review UI. */
export const QUALITY_FLAGS = [
  "thin_content",
  "low_readability",
  "formatting_issues",
  "machine_translation_risk",
  "outdated",
  "sensitive",
  "duplicate_suspected",
] as const;

const MAX_QUALITY_FLAGS = 20;

/** Normalizes an arbitrary flag list to deduped, slug-ish tokens. */
export function normalizeQualityFlags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const token = item.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
    if (!token || seen.has(token)) continue;
    seen.add(token);
    out.push(token);
    if (out.length >= MAX_QUALITY_FLAGS) break;
  }
  return out;
}

/** Parses stored `qualityFlags` JSON (array of strings) defensively. */
export function parseQualityFlags(raw: unknown): string[] {
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  return normalizeQualityFlags(parsed);
}

export type ReviewCorrections = {
  title?: string;
  excerpt?: string | null;
  category?: string | null;
  difficulty?: string | null;
  status?: "DRAFT" | "PUBLISHED";
  reviewState?: ReviewState;
  qualityFlags?: string[];
  tags?: string[];
  note?: string | null;
};

export type ReviewArticleInput = ReviewCorrections & {
  articleId: string;
  reviewerId?: string | null;
};

export type ReviewArticleResult =
  | {
      ok: true;
      articleId: string;
      reviewState: string;
      changes: Record<string, unknown>;
    }
  | { ok: false; error: string; status: number };

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

/**
 * Applies moderation corrections + a review verdict to an article and records a
 * ContentReview history row capturing the diff. Returns a structured error for
 * unknown ids / invalid input / a publish-while-taken-down attempt.
 */
export async function reviewArticle(
  input: ReviewArticleInput,
): Promise<ReviewArticleResult> {
  const article = await prisma.article.findUnique({
    where: { id: input.articleId },
    select: {
      id: true,
      title: true,
      excerpt: true,
      category: true,
      difficulty: true,
      status: true,
      reviewState: true,
      qualityFlags: true,
      takedownState: true,
      publishedAt: true,
    },
  });
  if (!article) {
    return { ok: false, error: "Article not found", status: 404 };
  }

  const data: Record<string, unknown> = {};
  const changes: Record<string, unknown> = {};

  if (input.title !== undefined) {
    const title = input.title.trim();
    if (!title) return { ok: false, error: "Title cannot be empty", status: 400 };
    if (title !== article.title) {
      data.title = title;
      changes.title = { from: article.title, to: title };
    }
  }

  if (input.excerpt !== undefined) {
    const excerpt = input.excerpt?.trim() ? input.excerpt.trim() : null;
    if (excerpt !== article.excerpt) {
      data.excerpt = excerpt;
      changes.excerpt = { from: article.excerpt, to: excerpt };
    }
  }

  if (input.category !== undefined) {
    const category = input.category ? input.category.trim() : null;
    if (category && !isValidCategorySlug(category)) {
      return { ok: false, error: "Invalid category", status: 400 };
    }
    if (category !== article.category) {
      data.category = category;
      changes.category = { from: article.category, to: category };
    }
  }

  if (input.difficulty !== undefined) {
    let difficulty: string | null = null;
    if (input.difficulty) {
      const parsed = parseLevel(input.difficulty);
      if (!parsed) return { ok: false, error: "Invalid difficulty level", status: 400 };
      difficulty = parsed;
    }
    if (difficulty !== article.difficulty) {
      data.difficulty = difficulty;
      changes.difficulty = { from: article.difficulty, to: difficulty };
    }
  }

  if (input.reviewState !== undefined) {
    if (!isReviewState(input.reviewState)) {
      return { ok: false, error: "Invalid review state", status: 400 };
    }
    if (input.reviewState !== article.reviewState) {
      data.reviewState = input.reviewState;
      changes.reviewState = { from: article.reviewState, to: input.reviewState };
    }
  }

  if (input.qualityFlags !== undefined) {
    const next = normalizeQualityFlags(input.qualityFlags);
    const prev = parseQualityFlags(article.qualityFlags);
    if (!arraysEqual(prev, next)) {
      data.qualityFlags = next;
      changes.qualityFlags = { from: prev, to: next };
    }
  }

  if (input.status !== undefined) {
    if (input.status !== "DRAFT" && input.status !== "PUBLISHED") {
      return { ok: false, error: "Invalid status", status: 400 };
    }
    if (input.status === "PUBLISHED" && article.takedownState !== "active") {
      return {
        ok: false,
        error: "Cannot publish an article that is under takedown/unpublish",
        status: 409,
      };
    }
    if (input.status !== article.status) {
      data.status = input.status as ArticleStatus;
      changes.status = { from: article.status, to: input.status };
      if (input.status === "PUBLISHED" && !article.publishedAt) {
        data.publishedAt = new Date();
      }
    }
  }

  // Tag corrections are a separate join table; reconcile them up front so the
  // recorded diff reflects the final set.
  if (input.tags !== undefined) {
    const before = (await getArticleTags(input.articleId)).map((t) => t.name);
    const after = (await setArticleTags(input.articleId, input.tags)) ?? [];
    const afterNames = after.map((t) => t.name);
    if (!arraysEqual(before, afterNames)) {
      changes.tags = { from: before, to: afterNames };
    }
  }

  const action = input.reviewState ? `review.${input.reviewState}` : "review.update";

  await prisma.$transaction(async (tx) => {
    if (Object.keys(data).length > 0) {
      await tx.article.update({ where: { id: input.articleId }, data });
    }
    await tx.contentReview.create({
      data: {
        articleId: input.articleId,
        reviewerId: input.reviewerId ?? null,
        action,
        note: input.note?.trim() ? input.note.trim() : null,
        changes: changes as Prisma.InputJsonValue,
      },
    });
  });

  return {
    ok: true,
    articleId: input.articleId,
    reviewState: (data.reviewState as string) ?? article.reviewState,
    changes,
  };
}

export type ContentReviewRow = {
  id: string;
  articleId: string;
  reviewerId: string | null;
  action: string;
  note: string | null;
  changes: unknown;
  createdAt: Date;
};

/** Returns an article's moderation/review history, newest first. */
export async function listContentReviews(
  articleId: string,
  limit = 50,
): Promise<ContentReviewRow[]> {
  return prisma.contentReview.findMany({
    where: { articleId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

// ---------------------------------------------------------------------------
// Takedown / rights policy
// ---------------------------------------------------------------------------

/** The governance/rights lifecycle states for an article. */
export const TAKEDOWN_STATES = [
  "active",
  "unpublished",
  "archived",
  "takedown",
] as const;

export type TakedownState = (typeof TAKEDOWN_STATES)[number];

export function isTakedownState(value: unknown): value is TakedownState {
  return typeof value === "string" && (TAKEDOWN_STATES as readonly string[]).includes(value);
}

/** Human labels for the admin UI. */
export const TAKEDOWN_STATE_LABELS: Record<TakedownState, string> = {
  active: "Active",
  unpublished: "Unpublished",
  archived: "Archived",
  takedown: "Takedown",
};

/** A non-active state should force a PUBLISHED article out of public feeds. */
export function takedownForcesDraft(state: TakedownState): boolean {
  return state !== "active";
}

export type ApplyTakedownInput = {
  articleId: string;
  state: TakedownState;
  reviewerId?: string | null;
  note?: string | null;
  rightsNote?: string | null;
};

export type ApplyTakedownResult =
  | {
      ok: true;
      articleId: string;
      previousState: TakedownState;
      state: TakedownState;
      status: string;
    }
  | { ok: false; error: string; status: number };

/**
 * Applies a takedown/rights transition to an article, records a ContentReview
 * history row, and (for any non-active state applied to a PUBLISHED article)
 * forces the article to DRAFT so it leaves public feeds. DRAFT/FAILED/ARCHIVED
 * articles are already out of public feeds, so their status is preserved even
 * on a non-active transition. Restoring to `active` leaves the status untouched
 * (an editor must re-publish deliberately). Returns a structured error for an
 * unknown id or invalid state.
 */
export async function applyTakedown(
  input: ApplyTakedownInput,
): Promise<ApplyTakedownResult> {
  if (!isTakedownState(input.state)) {
    return { ok: false, error: "Invalid takedown state", status: 400 };
  }

  return prisma.$transaction(async (tx) => {
    const existing = await tx.article.findUnique({
      where: { id: input.articleId },
      select: { id: true, takedownState: true, status: true, rightsNote: true },
    });
    if (!existing) {
      return { ok: false as const, error: "Article not found", status: 404 };
    }

    const previousState = (existing.takedownState as TakedownState) ?? "active";
    const forcesDraft = takedownForcesDraft(input.state);
    const nextStatus =
      forcesDraft && existing.status === ArticleStatus.PUBLISHED
        ? ArticleStatus.DRAFT
        : existing.status;

    await tx.article.update({
      where: { id: input.articleId },
      data: {
        takedownState: input.state,
        status: nextStatus,
        ...(input.rightsNote !== undefined ? { rightsNote: input.rightsNote } : {}),
      },
    });

    await tx.contentReview.create({
      data: {
        articleId: input.articleId,
        reviewerId: input.reviewerId ?? null,
        action: `takedown.${input.state}`,
        note: input.note ?? null,
        changes: {
          takedownState: { from: previousState, to: input.state },
          ...(forcesDraft && existing.status !== nextStatus
            ? { status: { from: existing.status, to: nextStatus } }
            : {}),
        },
      },
    });

    return {
      ok: true as const,
      articleId: input.articleId,
      previousState,
      state: input.state,
      status: nextStatus,
    };
  });
}
