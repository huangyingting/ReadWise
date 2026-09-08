/**
 * Annotation commands — server-side mutations.
 *
 * Every command scopes its WHERE to userId so ownership is always enforced
 * (no IDOR). Article existence / readability checks are the caller's
 * responsibility (enforced upstream by the reader route-guard).
 *
 * Offline semantics (RW-043):
 *   - createHighlight is idempotent via upsert: safe for offline retry.
 *   - updateHighlight detects offline note conflicts via baseUpdatedAt and
 *     preserves both versions rather than silently overwriting text.
 *   - deleteHighlight is an idempotent, ownership-scoped delete so replaying a
 *     request after a lost response cannot block causally dependent work.
 *
 * Pending-create follow-ups use the immutable article anchor and declare a
 * causal queue dependency on the create. Edits therefore survive ambiguous
 * create responses, and deletes cannot run unless the create is accepted.
 */
import { prisma } from "@/lib/prisma";
import { mergeNoteConflict } from "@/lib/offline-conflict";
import { validateAnchor, HIGHLIGHT_COLORS } from "./anchor";
import type {
  CreateHighlightInput,
  HighlightRow,
  UpdateHighlightInput,
} from "./anchor";
import { highlightSelect } from "./queries";

type CommandError = { ok: false; error: string; status: number };
type HighlightMutationData = { note?: string | null; color?: string | null };
type HighlightWriteResult = { ok: true; highlight: HighlightRow } | CommandError;
type HighlightUpdateResult =
  | { ok: true; highlight: HighlightRow; conflict: boolean }
  | CommandError;
type HighlightAnchorIdentity = {
  startOffset: number;
  endOffset: number;
};
type AnchoredHighlightUpdateInput = UpdateHighlightInput & {
  /** Note value the pending create was based on, used for conflict merging. */
  baseNote?: string | null;
};
const UPDATE_RETRY_LIMIT = 3;

function isHighlightColor(color: string): boolean {
  return (HIGHLIGHT_COLORS as readonly string[]).includes(color);
}

function invalidColorResult(): CommandError {
  return {
    ok: false,
    error: `color must be one of: ${HIGHLIGHT_COLORS.join(", ")}`,
    status: 400,
  };
}

function hasServerNoteChangedSinceBase(
  existing: { note: string | null; updatedAt: Date },
  incoming: string | null,
  baseUpdatedAt: Date | string,
): boolean {
  return (
    existing.note !== incoming &&
    new Date(existing.updatedAt).getTime() > new Date(baseUpdatedAt).getTime()
  );
}

/**
 * Create a new highlight for the authenticated user.
 * Validates the anchor before writing. Idempotent: if the same
 * (userId, articleId, startOffset, endOffset) already exists, the existing
 * highlight is returned unchanged (repeat saves succeed without error).
 */
export async function createHighlight(
  userId: string,
  articleId: string,
  input: CreateHighlightInput,
): Promise<HighlightWriteResult> {
  const validation = validateAnchor(input);
  if (!validation.ok) {
    return { ok: false, error: validation.error, status: 400 };
  }

  const highlight = await prisma.highlight.upsert({
    where: {
      userId_articleId_startOffset_endOffset: {
        userId,
        articleId,
        startOffset: input.startOffset,
        endOffset: input.endOffset,
      },
    },
    create: {
      userId,
      articleId,
      quote: input.quote.trim(),
      startOffset: input.startOffset,
      endOffset: input.endOffset,
      prefix: input.prefix ?? "",
      suffix: input.suffix ?? "",
      note: input.note ?? null,
      color: input.color ?? null,
    },
    // Duplicate: preserve anchor and existing note/color — no update needed.
    update: {},
    select: highlightSelect,
  });

  return { ok: true, highlight };
}

/**
 * Update the note and/or color of a highlight.
 * Ownership is checked via `where: {id, userId}` — returns a 404 result if
 * the highlight doesn't exist or belongs to another user.
 * Anchor fields (quote/offsets/prefix/suffix) are intentionally NOT updatable.
 *
 * Note merging (RW-043): when the server note changed after `baseUpdatedAt`,
 * both versions are preserved so offline text is never silently lost.
 */
export async function updateHighlight(
  id: string,
  userId: string,
  input: UpdateHighlightInput,
): Promise<HighlightUpdateResult> {
  if (
    input.color !== undefined &&
    input.color !== null &&
    !isHighlightColor(input.color)
  ) {
    return invalidColorResult();
  }

  let existing = await prisma.highlight.findFirst({
    where: { id, userId },
    select: { id: true, note: true, updatedAt: true },
  });
  if (!existing) {
    return { ok: false, error: "Highlight not found", status: 404 };
  }

  let conflict = false;

  for (let attempt = 0; attempt < UPDATE_RETRY_LIMIT; attempt += 1) {
    const data: HighlightMutationData = {};
    if ("note" in input) {
      const incoming = input.note ?? null;
      if (
        input.baseUpdatedAt != null &&
        hasServerNoteChangedSinceBase(existing, incoming, input.baseUpdatedAt)
      ) {
        const merged = mergeNoteConflict(existing.note, incoming);
        data.note = merged.text;
        conflict ||= merged.conflict;
      } else {
        data.note = incoming;
      }
    }
    if ("color" in input) data.color = input.color ?? null;

    const update = await prisma.highlight.updateMany({
      where: { id, userId, updatedAt: existing.updatedAt },
      data,
    });
    if (update.count === 1) {
      const highlight = await prisma.highlight.findFirst({
        where: { id, userId },
        select: highlightSelect,
      });
      if (!highlight) {
        return { ok: false, error: "Highlight not found", status: 404 };
      }
      return { ok: true, highlight, conflict };
    }

    const current = await prisma.highlight.findFirst({
      where: { id, userId },
      select: { id: true, note: true, updatedAt: true },
    });
    if (!current) {
      return { ok: false, error: "Highlight not found", status: 404 };
    }
    existing = current;
  }

  throw new Error("Highlight changed repeatedly while updating");
}

/**
 * Update a highlight through its immutable article anchor. Pending offline
 * creates do not yet have a server id, so follow-up edits use this stable
 * identity and remain valid even when the original create response was lost.
 */
export async function updateHighlightByAnchor(
  userId: string,
  articleId: string,
  anchor: HighlightAnchorIdentity,
  input: AnchoredHighlightUpdateInput,
): Promise<HighlightUpdateResult> {
  const existing = await prisma.highlight.findFirst({
    where: { userId, articleId, ...anchor },
    select: { id: true, note: true, updatedAt: true },
  });
  if (!existing) {
    return { ok: false, error: "Highlight not found", status: 404 };
  }

  let note = input.note;
  let conflict = false;
  if (
    "note" in input &&
    input.baseNote !== undefined &&
    existing.note !== input.baseNote &&
    existing.note !== (input.note ?? null)
  ) {
    const merged = mergeNoteConflict(existing.note, input.note ?? null);
    note = merged.text;
    conflict = merged.conflict;
  }

  const updateInput: UpdateHighlightInput = {
    baseUpdatedAt: existing.updatedAt,
  };
  if ("note" in input) updateInput.note = note ?? null;
  if ("color" in input) updateInput.color = input.color ?? null;

  const result = await updateHighlight(existing.id, userId, updateInput);
  return result.ok ? { ...result, conflict: result.conflict || conflict } : result;
}

/**
 * Delete a highlight.
 * Ownership is enforced in the delete predicate. An absent or foreign row is
 * indistinguishable from an already-deleted row, making offline replay safe
 * without exposing whether another user's highlight exists.
 */
export async function deleteHighlight(
  id: string,
  userId: string,
): Promise<{ ok: true }> {
  await prisma.highlight.deleteMany({ where: { id, userId } });
  return { ok: true };
}

/** Idempotently delete a pending/offline highlight through its stable anchor. */
export async function deleteHighlightByAnchor(
  userId: string,
  articleId: string,
  anchor: HighlightAnchorIdentity,
): Promise<{ ok: true }> {
  await prisma.highlight.deleteMany({
    where: { userId, articleId, ...anchor },
  });
  return { ok: true };
}
