/**
 * M11 — Highlights & Notes
 *
 * Every operation is scoped to the authenticated user (userId is ALWAYS in the
 * WHERE clause — no IDOR). Anchor fields (quote/startOffset/endOffset/prefix/
 * suffix) are written once at creation and never updated; only note/color are
 * editable.
 */

import { prisma } from "@/lib/prisma";

// ---------------------------------------------------------------------------
// Validation constants
// ---------------------------------------------------------------------------

/** Max character offset we accept (a very long article; guards against garbage). */
const MAX_OFFSET = 10_000_000;
/** Maximum length for the quote field (a reasonable upper bound for a selection). */
const MAX_QUOTE_LENGTH = 10_000;
/** Maximum context characters (prefix/suffix). */
const MAX_CONTEXT_LENGTH = 256;
/** Maximum length for a highlight note. Shared with the client so both can't drift. */
export const HIGHLIGHT_NOTE_MAX = 2_000;
/** Supported colour labels — null is always allowed (no colour). */
export const HIGHLIGHT_COLORS = ["yellow", "green", "blue", "pink"] as const;
export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CreateHighlightInput {
  quote: string;
  startOffset: number;
  endOffset: number;
  prefix?: string;
  suffix?: string;
  note?: string;
  color?: string;
}

export interface UpdateHighlightInput {
  note?: string;
  color?: string;
}

export interface HighlightRow {
  id: string;
  quote: string;
  startOffset: number;
  endOffset: number;
  prefix: string;
  suffix: string;
  note: string | null;
  color: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// ---------------------------------------------------------------------------
// Validation helpers (used by both the lib and routes)
// ---------------------------------------------------------------------------

export function validateAnchor(input: CreateHighlightInput):
  | { ok: true }
  | { ok: false; error: string } {
  if (!input.quote || input.quote.trim().length === 0) {
    return { ok: false, error: "quote is required" };
  }
  if (input.quote.length > MAX_QUOTE_LENGTH) {
    return { ok: false, error: `quote must be at most ${MAX_QUOTE_LENGTH} characters` };
  }
  if (!Number.isInteger(input.startOffset) || !Number.isInteger(input.endOffset)) {
    return { ok: false, error: "startOffset and endOffset must be integers" };
  }
  if (input.startOffset < 0) {
    return { ok: false, error: "startOffset must be >= 0" };
  }
  if (input.endOffset > MAX_OFFSET) {
    return { ok: false, error: `endOffset must be <= ${MAX_OFFSET}` };
  }
  if (input.startOffset >= input.endOffset) {
    return { ok: false, error: "startOffset must be less than endOffset" };
  }
  if (input.prefix && input.prefix.length > MAX_CONTEXT_LENGTH) {
    return { ok: false, error: `prefix must be at most ${MAX_CONTEXT_LENGTH} characters` };
  }
  if (input.suffix && input.suffix.length > MAX_CONTEXT_LENGTH) {
    return { ok: false, error: `suffix must be at most ${MAX_CONTEXT_LENGTH} characters` };
  }
  if (input.color !== undefined && input.color !== null) {
    if (!(HIGHLIGHT_COLORS as readonly string[]).includes(input.color)) {
      return { ok: false, error: `color must be one of: ${HIGHLIGHT_COLORS.join(", ")}` };
    }
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const highlightSelect = {
  id: true,
  quote: true,
  startOffset: true,
  endOffset: true,
  prefix: true,
  suffix: true,
  note: true,
  color: true,
  createdAt: true,
  updatedAt: true,
} as const;

/**
 * List all highlights for a given user + article, ordered by startOffset.
 * Returns an empty array when the article exists but has no highlights.
 * Does NOT validate article existence — callers must check that separately.
 */
export async function listHighlights(
  userId: string,
  articleId: string,
): Promise<HighlightRow[]> {
  return prisma.highlight.findMany({
    where: { userId, articleId },
    select: highlightSelect,
    orderBy: { startOffset: "asc" },
  });
}

/**
 * Create a new highlight for the authenticated user.
 * Validates the anchor before writing. Idempotent: if the same
 * (userId, articleId, startOffset, endOffset) already exists the existing
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
 */
export async function updateHighlight(
  id: string,
  userId: string,
  input: UpdateHighlightInput,
): Promise<
  { ok: true; highlight: HighlightRow } | { ok: false; error: string; status: number }
> {
  // Validate color if provided
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
    select: { id: true },
  });
  if (!existing) {
    return { ok: false, error: "Highlight not found", status: 404 };
  }

  const data: { note?: string | null; color?: string | null } = {};
  if ("note" in input) data.note = input.note ?? null;
  if ("color" in input) data.color = input.color ?? null;

  const highlight = await prisma.highlight.update({
    where: { id },
    data,
    select: highlightSelect,
  });

  return { ok: true, highlight };
}

/**
 * Delete a highlight.
 * Ownership is checked via `where: {id, userId}` — returns a 404 result if the
 * highlight doesn't exist or belongs to another user.
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

// ---------------------------------------------------------------------------
// Cross-article aggregation
// ---------------------------------------------------------------------------

export interface HighlightWithArticle extends HighlightRow {
  article: { id: string; title: string };
}

/**
 * Returns ALL highlights across ALL articles for the given user, newest first
 * within each article. Includes the article id + title for display.
 * Every row is scoped to `userId` — no IDOR possible.
 */
export async function listAllUserHighlights(
  userId: string,
): Promise<HighlightWithArticle[]> {
  return prisma.highlight.findMany({
    where: { userId },
    select: {
      ...highlightSelect,
      article: { select: { id: true, title: true } },
    },
    orderBy: [{ article: { title: "asc" } }, { createdAt: "desc" }],
  });
}

// ---------------------------------------------------------------------------
// Counts
// ---------------------------------------------------------------------------

/**
 * Batch count of highlights per article for the given user.
 * Useful for dashboards / listing badges. Returns a map of articleId → count
 * (articles with 0 highlights are omitted).
 */
export async function getHighlightCounts(
  userId: string,
  articleIds: string[],
): Promise<Record<string, number>> {
  if (articleIds.length === 0) return {};

  const rows = await prisma.highlight.groupBy({
    by: ["articleId"],
    where: { userId, articleId: { in: articleIds } },
    _count: { id: true },
  });

  const map: Record<string, number> = {};
  for (const row of rows) {
    map[row.articleId] = row._count.id;
  }
  return map;
}
