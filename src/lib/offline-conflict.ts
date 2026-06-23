/**
 * Offline conflict resolution (RW-043).
 *
 * Pure, side-effect-free rules for reconciling edits made offline (or on
 * another device) with the current server state. No Prisma / network imports
 * so every rule is unit-testable. The conflict policy per data type:
 *
 *   - Reading progress: FORWARD-ONLY. The stored percent never decreases and
 *     completion is sticky (already enforced by `saveProgress`). See
 *     {@link resolveProgress}.
 *   - Highlights: ANCHOR REVALIDATION. If the article's sanitized content
 *     changed so the stored quote no longer sits at its offsets, the highlight
 *     is marked stale (and may be re-anchored). See {@link revalidateAnchor}.
 *   - Saved words / sentence data: LAST-WRITE-WINS by `updatedAt`.
 *     See {@link resolveLastWriteWins}.
 *   - Notes (highlight annotations): LAST-WRITE-WINS, but text is NEVER
 *     silently lost. When the server note changed since the offline edit, both
 *     versions are preserved in a merged note the user can clean up. See
 *     {@link mergeNoteConflict}.
 */

// ---------------------------------------------------------------------------
// Reading progress — forward-only
// ---------------------------------------------------------------------------

/**
 * Forward-only reconciliation: returns whichever percent is higher and keeps
 * completion sticky. Mirrors the server's `saveProgress` so the client can make
 * the same decision optimistically before a sync round-trip.
 */
export function resolveProgress(
  server: { percent: number; completed: boolean },
  client: { percent: number; completed: boolean },
  completionThreshold = 95,
): { percent: number; completed: boolean } {
  const percent = Math.max(server.percent, client.percent);
  const completed =
    server.completed || client.completed || percent >= completionThreshold;
  return { percent, completed };
}

// ---------------------------------------------------------------------------
// Generic last-write-wins
// ---------------------------------------------------------------------------

/**
 * Last-write-wins by timestamp. Returns "client" when the offline edit is
 * strictly newer than the server's, otherwise "server" (ties favour the
 * server, which already persisted its value).
 */
export function resolveLastWriteWins(
  serverUpdatedAt: Date | string | number,
  clientUpdatedAt: Date | string | number,
): "server" | "client" {
  const s = new Date(serverUpdatedAt).getTime();
  const c = new Date(clientUpdatedAt).getTime();
  return c > s ? "client" : "server";
}

// ---------------------------------------------------------------------------
// Highlight anchor revalidation
// ---------------------------------------------------------------------------

export interface HighlightAnchor {
  quote: string;
  startOffset: number;
  endOffset: number;
  prefix?: string | null;
  suffix?: string | null;
}

export type AnchorStatus = "valid" | "moved" | "missing";

export interface AnchorRevalidation {
  status: AnchorStatus;
  /** Convenience flag: true when the stored anchor no longer matches exactly. */
  stale: boolean;
  /** When status === "moved", the offsets where the quote now sits. */
  suggestedStartOffset?: number;
  suggestedEndOffset?: number;
}

/** Collapse runs of whitespace so trivial reflow doesn't trigger false staleness. */
function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Escape a string for safe embedding in a RegExp. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Revalidate a highlight anchor against the article's current plain text:
 *   - "valid":   the quote still sits exactly at [startOffset, endOffset).
 *   - "moved":   the quote text still exists but at a different position
 *                (content shifted) — offsets can be re-anchored.
 *   - "missing": the quote text is gone entirely — the highlight is stale.
 *
 * Substring-based (not exact-offset-only) so it is robust to small differences
 * between how the client built the plain text and how the server derives it.
 */
export function revalidateAnchor(
  anchor: HighlightAnchor,
  plainText: string,
): AnchorRevalidation {
  const quote = anchor.quote ?? "";
  if (quote.length === 0) {
    return { status: "missing", stale: true };
  }

  const slice = plainText.slice(anchor.startOffset, anchor.endOffset);
  if (slice === quote || normalizeWhitespace(slice) === normalizeWhitespace(quote)) {
    return { status: "valid", stale: false };
  }

  // The quote drifted — try to find it elsewhere, preferring a match adjacent
  // to the stored prefix/suffix to avoid latching onto an unrelated repeat.
  const withContext = `${anchor.prefix ?? ""}${quote}${anchor.suffix ?? ""}`;
  const ctxIndex =
    anchor.prefix || anchor.suffix ? plainText.indexOf(withContext) : -1;
  if (ctxIndex >= 0) {
    const start = ctxIndex + (anchor.prefix ?? "").length;
    return {
      status: "moved",
      stale: true,
      suggestedStartOffset: start,
      suggestedEndOffset: start + quote.length,
    };
  }

  const index = plainText.indexOf(quote);
  if (index >= 0) {
    return {
      status: "moved",
      stale: true,
      suggestedStartOffset: index,
      suggestedEndOffset: index + quote.length,
    };
  }

  // Whitespace-tolerant fallback: match the quote's tokens separated by any run
  // of whitespace, so a reflow (single → multiple spaces, wrapped newlines)
  // re-anchors instead of being reported as missing.
  const tokens = normalizeWhitespace(quote).split(" ").filter(Boolean);
  if (tokens.length > 0) {
    const flexible = new RegExp(tokens.map(escapeRegExp).join("\\s+"));
    const match = flexible.exec(plainText);
    if (match) {
      return {
        status: "moved",
        stale: true,
        suggestedStartOffset: match.index,
        suggestedEndOffset: match.index + match[0].length,
      };
    }
  }

  return { status: "missing", stale: true };
}

// ---------------------------------------------------------------------------
// Note conflict merge
// ---------------------------------------------------------------------------

/** Marker inserted between the two versions of a conflicting note. */
export const NOTE_CONFLICT_SEPARATOR =
  "\n\n--- ⚠ also edited on another device ---\n";

export interface NoteMergeResult {
  /** The reconciled note text. */
  text: string | null;
  /** True when both sides diverged from the base and both were preserved. */
  conflict: boolean;
}

/**
 * Merge a note edited offline (`clientNote`) with the server's current note
 * (`serverNote`), given the `baseNote` the client started from.
 *
 * Rules (text is NEVER silently lost):
 *   - server unchanged since base  → take the client edit.
 *   - client equals server         → no conflict, take either.
 *   - both diverged from base      → CONFLICT: keep both, client first,
 *                                     separated by {@link NOTE_CONFLICT_SEPARATOR}.
 *
 * `baseNote` may be omitted (offline record predates conflict tracking); in
 * that case any difference between client and server is treated as a conflict
 * so no text is dropped.
 */
export function mergeNoteConflict(
  serverNote: string | null | undefined,
  clientNote: string | null | undefined,
  baseNote?: string | null,
): NoteMergeResult {
  const server = (serverNote ?? "").trim();
  const client = (clientNote ?? "").trim();
  const base = baseNote == null ? null : baseNote.trim();

  if (server === client) {
    return { text: client.length ? client : null, conflict: false };
  }
  // Server never changed from what the client started with → client wins.
  if (base !== null && server === base) {
    return { text: client.length ? client : null, conflict: false };
  }
  // Client never actually changed it → keep the server's newer value.
  if (base !== null && client === base) {
    return { text: server.length ? server : null, conflict: false };
  }
  // Both sides diverged (or base is unknown) → preserve both.
  if (server.length === 0) {
    return { text: client.length ? client : null, conflict: false };
  }
  if (client.length === 0) {
    return { text: server.length ? server : null, conflict: false };
  }
  return {
    text: `${client}${NOTE_CONFLICT_SEPARATOR}${server}`,
    conflict: true,
  };
}
