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
 *   - deleteHighlight returns 404 for a highlight that doesn't exist or isn't
 *     owned by the caller; offline sync should treat 404 as already-deleted.
 *
 * Create-then-delete offline edge case:
 *   If the offline queue delivers a CREATE and DELETE for the same highlight,
 *   processing them in order (create → delete) produces the correct result:
 *   upsert creates/finds the row, then delete removes it. If the queue
 *   delivers them out of order (delete first), the delete returns 404 and the
 *   subsequent create via upsert re-creates the row. The accepted behavior is
 *   that a well-ordered sync queue is required for correct create-then-delete
 *   reconciliation; out-of-order delivery leaves the highlight present.
 */
import { prisma } from "@/lib/prisma";
import { mergeNoteConflict } from "@/lib/offline-conflict";
import { validateAnchor, HIGHLIGHT_COLORS } from "./anchor";
import type { CreateHighlightInput, UpdateHighlightInput, HighlightRow } from "./anchor";
import { highlightSelect } from "./queries";

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
): Promise<{ ok: true; highlight: HighlightRow } | { ok: false; error: string; status: number }> {
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
): Promise<
  | { ok: true; highlight: HighlightRow; conflict: boolean }
  | { ok: false; error: string; status: number }
> {
  if (input.color !== undefined && input.color !== null) {
    if (!(HIGHLIGHT_COLORS as readonly string[]).includes(input.color)) {
      return {
        ok: false,
        error: `color must be one of: ${HIGHLIGHT_COLORS.join(", ")}`,
        status: 400,
      };
    }
  }

  const existing = await prisma.highlight.findFirst({
    where: { id, userId },
    select: { id: true, note: true, updatedAt: true },
  });
  if (!existing) {
    return { ok: false, error: "Highlight not found", status: 404 };
  }

  const data: { note?: string | null; color?: string | null } = {};
  let conflict = false;
  if ("note" in input) {
    const incoming = input.note ?? null;
    // Last-write-wins, but never silently lose text: if the stored note changed
    // since the offline client based its edit, merge both versions (RW-043).
    if (
      input.baseUpdatedAt != null &&
      existing.note !== incoming &&
      new Date(existing.updatedAt).getTime() > new Date(input.baseUpdatedAt).getTime()
    ) {
      const merged = mergeNoteConflict(existing.note, incoming);
      data.note = merged.text;
      conflict = merged.conflict;
    } else {
      data.note = incoming;
    }
  }
  if ("color" in input) data.color = input.color ?? null;

  const highlight = await prisma.highlight.update({
    where: { id },
    data,
    select: highlightSelect,
  });

  return { ok: true, highlight, conflict };
}

/**
 * Delete a highlight.
 * Ownership is checked via `where: {id, userId}` — returns a 404 result if
 * the highlight doesn't exist or belongs to another user.
 * Offline sync should treat a 404 response as "already deleted" (idempotent).
 */
export async function deleteHighlight(
  id: string,
  userId: string,
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const existing = await prisma.highlight.findFirst({
    where: { id, userId },
    select: { id: true },
  });
  if (!existing) {
    return { ok: false, error: "Highlight not found", status: 404 };
  }

  await prisma.highlight.delete({ where: { id } });
  return { ok: true };
}
