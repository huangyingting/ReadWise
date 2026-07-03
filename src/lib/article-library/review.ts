/**
 * Content quality review workflow — article-library subsystem (REF-040, BE-7).
 *
 * An orthogonal REVIEW axis on articles: field corrections, verdicts, and an
 * append-only ContentReview history. The complementary RIGHTS/governance axis
 * lives in {@link ./takedown}.
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

type ArticleUpdateData = Record<string, unknown>;
type ArticleChanges = Record<string, unknown>;

function normalizeNullableText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function recordChangedField(
  data: ArticleUpdateData,
  changes: ArticleChanges,
  field: string,
  from: unknown,
  to: unknown,
): void {
  if (to === from) return;
  data[field] = to;
  changes[field] = { from, to };
}

function reviewAction(reviewState?: ReviewState): string {
  return reviewState ? `review.${reviewState}` : "review.update";
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

  const data: ArticleUpdateData = {};
  const changes: ArticleChanges = {};

  if (input.title !== undefined) {
    const title = input.title.trim();
    if (!title) return { ok: false, error: "Title cannot be empty", status: 400 };
    recordChangedField(data, changes, "title", article.title, title);
  }

  if (input.excerpt !== undefined) {
    const excerpt = normalizeNullableText(input.excerpt);
    recordChangedField(data, changes, "excerpt", article.excerpt, excerpt);
  }

  if (input.category !== undefined) {
    const category = input.category ? input.category.trim() : null;
    if (category && !isValidCategorySlug(category)) {
      return { ok: false, error: "Invalid category", status: 400 };
    }
    recordChangedField(data, changes, "category", article.category, category);
  }

  if (input.difficulty !== undefined) {
    let difficulty: string | null = null;
    if (input.difficulty) {
      const parsed = parseLevel(input.difficulty);
      if (!parsed) return { ok: false, error: "Invalid difficulty level", status: 400 };
      difficulty = parsed;
    }
    recordChangedField(data, changes, "difficulty", article.difficulty, difficulty);
  }

  if (input.reviewState !== undefined) {
    if (!isReviewState(input.reviewState)) {
      return { ok: false, error: "Invalid review state", status: 400 };
    }
    recordChangedField(data, changes, "reviewState", article.reviewState, input.reviewState);
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
      recordChangedField(
        data,
        changes,
        "status",
        article.status,
        input.status as ArticleStatus,
      );
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

  const action = reviewAction(input.reviewState);

  await prisma.$transaction(async (tx) => {
    if (Object.keys(data).length > 0) {
      await tx.article.update({ where: { id: input.articleId }, data });
    }
    await tx.contentReview.create({
      data: {
        articleId: input.articleId,
        reviewerId: input.reviewerId ?? null,
        action,
        note: normalizeNullableText(input.note),
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
