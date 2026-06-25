/**
 * Annotation anchor helpers — pure, side-effect-free.
 *
 * Provides shared types, validation constants, and stateless helpers used
 * across the annotation subsystem. No Prisma or network imports so every
 * function here is unit-testable without stubs.
 */
import { revalidateAnchor, type AnchorStatus } from "@/lib/offline-conflict";

// ---------------------------------------------------------------------------
// Validation constants (exported so routes and clients share the same limits)
// ---------------------------------------------------------------------------

/** Maximum length for a highlight note. Shared with the client so both can't drift. */
export const HIGHLIGHT_NOTE_MAX = 2_000;
/** Supported colour labels — null is always allowed (no colour). */
export const HIGHLIGHT_COLORS = ["yellow", "green", "blue", "pink"] as const;
export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number];

const MAX_OFFSET = 10_000_000;
const MAX_QUOTE_LENGTH = 10_000;
const MAX_CONTEXT_LENGTH = 256;

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
  /**
   * RW-043 — the `updatedAt` the offline client last saw. When provided and the
   * stored note changed since then, the note is merged (both versions kept)
   * instead of overwritten so offline text is never silently lost.
   */
  baseUpdatedAt?: Date | string;
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

/** A highlight annotated with the result of anchor revalidation (RW-043). */
export interface HighlightWithAnchor extends HighlightRow {
  /** True when the stored anchor no longer matches the current content. */
  stale: boolean;
  anchorStatus: AnchorStatus;
  suggestedStartOffset?: number;
  suggestedEndOffset?: number;
}

export interface HighlightWithArticle extends HighlightRow {
  article: { id: string; title: string };
}

// ---------------------------------------------------------------------------
// Anchor validation
// ---------------------------------------------------------------------------

/**
 * Validate the anchor fields of a create-highlight input.
 * Returns `{ok: true}` or `{ok: false, error: string}`.
 */
export function validateAnchor(
  input: CreateHighlightInput,
): { ok: true } | { ok: false; error: string } {
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
// Anchor annotation (anchor revalidation enrichment)
// ---------------------------------------------------------------------------

/**
 * Revalidate each highlight's anchor against the article's current plain text.
 * Stale highlights are FLAGGED (never dropped) so the reader can surface them
 * and the user decides what to do — moved anchors carry suggested offsets.
 */
export function annotateHighlightAnchors(
  rows: HighlightRow[],
  plainText: string,
): HighlightWithAnchor[] {
  return rows.map((row) => {
    const result = revalidateAnchor(
      {
        quote: row.quote,
        startOffset: row.startOffset,
        endOffset: row.endOffset,
        prefix: row.prefix,
        suffix: row.suffix,
      },
      plainText,
    );
    return {
      ...row,
      stale: result.stale,
      anchorStatus: result.status,
      suggestedStartOffset: result.suggestedStartOffset,
      suggestedEndOffset: result.suggestedEndOffset,
    };
  });
}
