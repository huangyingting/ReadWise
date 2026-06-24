/**
 * Content rights & takedown policy (Epic RW-E009 — RW-047).
 *
 * An article's lifecycle has two ORTHOGONAL axes:
 *   - `status` (DRAFT/PUBLISHED) — the existing editorial/processing pipeline.
 *   - `takedownState` (this module) — a RIGHTS/governance axis recording whether
 *     content must be withheld for licensing, robots, DMCA or other reasons.
 *
 * The states form a clear progression:
 *   - `active`      — normal; visibility follows `status`.
 *   - `unpublished` — temporarily withheld (e.g. quality/rights review); if the
 *     article is PUBLISHED it is forced to DRAFT so it leaves public feeds.
 *   - `archived`    — retired from the library but retained; PUBLISHED articles
 *     are forced to DRAFT; other statuses (DRAFT/FAILED) are preserved.
 *   - `takedown`    — a formal rights/DMCA takedown; PUBLISHED articles are
 *     forced to DRAFT and the article is flagged so it is never re-published
 *     without a deliberate restore. DRAFT/FAILED/ARCHIVED status is preserved.
 *
 * Applying any non-active state DRAFTS the article (defense in depth — feeds
 * already filter on status). Restoring to `active` does NOT auto-publish; an
 * editor must publish via the normal flow, so a takedown can't be silently
 * reversed. All transitions are recorded in {@link ContentReview} history and
 * the audit log by the calling route.
 */
import { prisma } from "@/lib/prisma";
import { ArticleStatus } from "@prisma/client";

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
 * Applies a takedown/rights transition to an article, records a
 * {@link ContentReview} history row, and (for any non-active state applied to
 * a PUBLISHED article) forces the article to DRAFT so it leaves public feeds.
 * DRAFT/FAILED/ARCHIVED articles are already out of public feeds, so their
 * status is preserved even on a non-active transition — this avoids silently
 * converting a FAILED article to DRAFT and losing that status information.
 * Restoring to `active` leaves the status untouched (an editor must re-publish
 * deliberately). Returns a structured error for an unknown id or invalid state
 * — never throws for the normal not-found / validation paths.
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
    // Only force DRAFT when the article is currently PUBLISHED — PUBLISHED is
    // the only status that appears in public feeds. DRAFT/FAILED/ARCHIVED are
    // already non-public, so demoting them to DRAFT would silently erase their
    // status (e.g. FAILED → DRAFT makes it look re-processable).
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
