/**
 * Today Session — learner-selected primary article (v1.1, #805).
 *
 * @server-only — imports Prisma (via the generator + repository) and the
 * Article Library access policy.
 *
 * Lets a learner OVERRIDE the generated `resume`/`picks` primary with a
 * readable article of their own choosing. The override is a **plan mutation**
 * (unlike skip, which is a terminal day transition): it swaps the primary id,
 * stamps `source = "user_selected"`, and RETAINS the replaced generated id by
 * appending it to the stable backup list (ids only) so the prior pick is never
 * lost for analytics or the browse fallback.
 *
 * Access & safety invariants:
 *   - The article MUST be readable by THIS user via the Article Library policy
 *     (`getReadableArticleById`). Another user's private article (or a missing
 *     id) resolves to nothing → {@link SetTodayArticleError} `not_found` (404):
 *     existence is never leaked (IDOR-safe).
 *   - Only a `PUBLISHED` article can become today's primary. An article still
 *     `PROCESSING`, or one that `FAILED`/is otherwise not ready, is blocked with
 *     a clear `not_ready` error so the UI can message it.
 *   - `ReadingProgress` is NEVER read, deleted, or altered here — choosing a new
 *     primary cannot fabricate or wipe reading-progress facts.
 *   - Always scoped to the authenticated `userId`; no id is ever trusted from a
 *     request body. Idempotent on re-selection of the same article.
 *   - Only ids/anchors are persisted — never article text, titles, or notes.
 */

import { ArticleStatus } from "@prisma/client";
import {
  articleAccessContext,
  getReadableArticleById,
} from "@/lib/article-library";
import { getOrCreateTodaySession } from "./generator";
import { updateTodaySession } from "./repository";
import { resolveLocalDate } from "./local-date";
import { emitTodayArticleSelected } from "./analytics";
import type { TodaySessionView } from "./types";

/** Reason a {@link setTodayPrimaryArticle} attempt failed, mapped to HTTP status. */
export type SetTodayArticleErrorCode = "not_found" | "not_ready";

/**
 * Thrown when the chosen article cannot become today's primary. `code`
 * distinguishes an inaccessible/missing article (`not_found` → 404, IDOR-safe)
 * from a readable-but-not-yet-ready article (`not_ready` → 409). The `message`
 * is a clear, content-free string safe to surface to the learner.
 */
export class SetTodayArticleError extends Error {
  readonly code: SetTodayArticleErrorCode;
  constructor(code: SetTodayArticleErrorCode, message: string) {
    super(message);
    this.name = "SetTodayArticleError";
    this.code = code;
  }
}

/** Clear, content-free messaging for a readable-but-not-ready article. */
function notReadyMessage(status: ArticleStatus): string {
  switch (status) {
    case ArticleStatus.PROCESSING:
      return "This article is still being processed. Try again once it's ready.";
    case ArticleStatus.FAILED:
      return "This import failed to process and can't be set as today's article.";
    default:
      return "This article isn't ready to read yet.";
  }
}

/**
 * Set a readable article as the learner's primary article for their local day.
 *
 * Validates access + readiness, then swaps the primary while preserving the
 * replaced generated id in the stable backup list. Returns the updated session
 * view. Throws {@link SetTodayArticleError} for an inaccessible (`not_found`)
 * or not-yet-ready (`not_ready`) article — nothing is written in either case.
 */
export async function setTodayPrimaryArticle(args: {
  user: { id: string; role?: string | null };
  articleId: string;
  requestTimezone?: string | null;
  now?: Date;
}): Promise<TodaySessionView> {
  const now = args.now ?? new Date();
  const userId = args.user.id;

  // Validate readable access for THIS user BEFORE any session write (fail
  // closed). A missing id or another user's private article resolves to null —
  // surfaced as 404 so we never confirm the existence of an inaccessible row.
  const context = articleAccessContext({ id: userId, role: args.user.role ?? null });
  const article = await getReadableArticleById(args.articleId, context, {
    select: { id: true, status: true },
  });
  if (!article) {
    throw new SetTodayArticleError(
      "not_found",
      "That article isn't available to read.",
    );
  }
  if (article.status !== ArticleStatus.PUBLISHED) {
    // Readable (owned) but still processing / failed / otherwise not ready.
    throw new SetTodayArticleError("not_ready", notReadyMessage(article.status));
  }

  const { localDate, timezone } = await resolveLocalDate({
    userId,
    requestTimezone: args.requestTimezone,
    now,
  });

  // Ensure a stable session exists for the day (created on demand on first
  // contact, exactly like skip/read-complete).
  const session = await getOrCreateTodaySession({
    userId,
    localDate,
    timezoneSnapshot: timezone,
    now,
  });

  // Idempotent: re-selecting the already-active user-chosen primary is a no-op.
  if (
    session.primaryArticleId === article.id &&
    session.source === "user_selected"
  ) {
    return session;
  }

  // Retain the replaced primary id as a known backup anchor (ids only) so the
  // prior generated/selected pick is preserved for analytics + browse fallback,
  // without duplicating an id already present and without listing the new
  // primary among the backups.
  const replacedId = session.primaryArticleId;
  let nextBackupIds = session.backupArticleIds.filter((id) => id !== article.id);
  if (replacedId && replacedId !== article.id && !nextBackupIds.includes(replacedId)) {
    nextBackupIds = [...nextBackupIds, replacedId];
  }

  const updated = await updateTodaySession(userId, localDate, {
    primaryArticleId: article.id,
    source: "user_selected",
    backupArticleIds: nextBackupIds,
  });

  // `updateMany` matched the row we just created/loaded; fall back to the loaded
  // view defensively if a concurrent delete raced us.
  const result = updated ?? session;

  // Product analytics (#805): record the user-selected override. Best-effort +
  // metadata only (source/flags/counts) — never article content. Includes
  // whether a generated primary was replaced so the override funnel is visible.
  if (updated != null) {
    await emitTodayArticleSelected(result, { replacedGenerated: replacedId != null });
  }

  return result;
}
