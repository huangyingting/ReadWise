"use client";

/**
 * ReaderNotesPanel (M11)
 *
 * Content for the 5th "Notes" tab in ReaderToolsPanel. Reads highlights
 * from the ReaderHighlightsProvider context (no per-tab lazy fetch — the
 * marks need the data eagerly anyway).
 *
 * Features:
 *  - List ordered by startOffset (document order)
 *  - Each row: color swatch + quote (scroll-to button) + note + actions
 *  - Orphaned indicator for highlights that can't be re-anchored
 *  - Inline note editing (same control as HighlightEditPopover)
 *  - M8 ConfirmAction delete
 *  - M4 EmptyState when no highlights
 */

import { useState, useCallback } from "react";
import { Highlighter, Pencil, Trash2, AlertTriangle } from "lucide-react";
import { cn, focusRing } from "@/lib/cn";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import EmptyState from "@/components/EmptyState";
import ConfirmAction from "@/components/ConfirmAction";
import {
  useHighlights,
  type Highlight,
  type HighlightColor,
  HIGHLIGHT_COLORS,
} from "./ReaderHighlightsProvider";
import { SWATCH_COLORS } from "./SelectionToolbar";

const NOTE_MAX = 2000;

const COLOR_SWATCH_BG: Record<HighlightColor, string> = {
  yellow: "var(--hl-yellow)",
  green:  "var(--hl-green)",
  blue:   "var(--hl-blue)",
  pink:   "var(--hl-pink)",
};

/** Flash a <mark> in the prose by its data-hl-id and scroll it into view. */
function flashAndScroll(hlId: string) {
  const marks = Array.from(
    document.querySelectorAll<HTMLElement>(`mark.rw-hl[data-hl-id="${hlId}"]`),
  );
  if (marks.length === 0) return;

  const first = marks[0];
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  first.scrollIntoView({
    behavior: reducedMotion ? "auto" : "smooth",
    block: "center",
  });

  // Apply flash animation
  marks.forEach((m) => {
    m.classList.remove("rw-hl-flash");
    // Force reflow so removing + re-adding triggers the animation
    void m.offsetHeight;
    m.classList.add("rw-hl-flash");
    setTimeout(() => {
      m.classList.remove("rw-hl-flash");
      // For reduced-motion, remove the static outline after 1200ms
      if (reducedMotion) m.style.outline = "";
    }, 1200);
  });
}

// ---------------------------------------------------------------------------
// Inline note editor (used within each row)
// ---------------------------------------------------------------------------

interface NoteEditorProps {
  initialNote: string;
  onSave: (note: string | null) => void;
  onCancel: () => void;
}

function NoteEditor({ initialNote, onSave, onCancel }: NoteEditorProps) {
  const [text, setText] = useState(initialNote);
  const nearLimit = text.length > NOTE_MAX * 0.85;
  const atLimit = text.length >= NOTE_MAX;

  return (
    <div className="rw-note-inline-edit">
      <textarea
        className="rw-note-input"
        value={text}
        maxLength={NOTE_MAX}
        rows={3}
        placeholder="Add a note…"
        aria-label="Highlight note"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") { e.preventDefault(); onCancel(); }
        }}
        // eslint-disable-next-line jsx-a11y/no-autofocus
        autoFocus
      />
      {(nearLimit || atLimit) && (
        <p
          className={cn(
            "rw-note-counter",
            atLimit ? "at-limit" : nearLimit ? "near-limit" : "",
          )}
        >
          {text.length}/{NOTE_MAX}
        </p>
      )}
      <div className="rw-note-inline-actions">
        <Button
          size="sm"
          onClick={() => onSave(text.trim() || null)}
          disabled={atLimit && text.length > NOTE_MAX}
        >
          Save
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Single note row
// ---------------------------------------------------------------------------

interface NoteRowProps {
  highlight: Highlight;
  isOrphaned: boolean;
  onUpdateColor: (color: HighlightColor) => void;
  onUpdateNote: (note: string | null) => void;
  onDelete: () => Promise<void>;
}

function NoteRow({
  highlight,
  isOrphaned,
  onUpdateColor,
  onUpdateNote,
  onDelete,
}: NoteRowProps) {
  const [editingNote, setEditingNote] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const hlColor = (highlight.color as HighlightColor | null) ?? "yellow";
  const swatchBg = COLOR_SWATCH_BG[hlColor] ?? COLOR_SWATCH_BG.yellow;

  const handleScrollTo = useCallback(() => {
    if (!isOrphaned) flashAndScroll(highlight.id);
  }, [highlight.id, isOrphaned]);

  return (
    <div className="rw-note-row">
      {/* Color swatch — static indicator */}
      <div
        className="rw-note-row-swatch"
        style={{ backgroundColor: swatchBg }}
        aria-hidden="true"
      />

      <div className="rw-note-row-body">
        {/* Quote — scroll-to trigger */}
        <button
          type="button"
          className="rw-note-row-quote"
          aria-label={`Go to highlight: ${highlight.quote.slice(0, 60)}`}
          disabled={isOrphaned}
          onClick={handleScrollTo}
        >
          &ldquo;{highlight.quote}&rdquo;
        </button>

        {/* Orphaned indicator */}
        {isOrphaned ? (
          <span className="rw-note-row-orphaned">
            <AlertTriangle size={11} aria-hidden="true" />
            Not found in current text
          </span>
        ) : null}

        {/* Note or inline editor */}
        {editingNote ? (
          <NoteEditor
            initialNote={highlight.note ?? ""}
            onSave={(note) => {
              onUpdateNote(note);
              setEditingNote(false);
            }}
            onCancel={() => setEditingNote(false)}
          />
        ) : highlight.note ? (
          <p className="rw-note-row-note">{highlight.note}</p>
        ) : (
          <button
            type="button"
            className="rw-note-row-add-note"
            onClick={() => setEditingNote(true)}
          >
            Add a note…
          </button>
        )}
      </div>

      {/* Row actions */}
      {!editingNote && (
        <div className="rw-note-row-actions">
          <button
            type="button"
            className={cn("rw-note-row-icon-btn", focusRing)}
            aria-label={highlight.note ? "Edit note" : "Add note"}
            onClick={() => setEditingNote(true)}
          >
            <Pencil size={14} aria-hidden="true" />
          </button>

          <ConfirmAction
            triggerLabel=""
            triggerVariant="danger"
            size="sm"
            confirmMessage="Delete this highlight and its note?"
            loading={deleting}
            className="contents"
            onConfirm={async () => {
              setDeleting(true);
              try {
                await onDelete();
              } finally {
                setDeleting(false);
              }
            }}
          />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Color mini-picker for the row (hidden for now — kept as static indicator)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export default function ReaderNotesPanel() {
  const { highlights, loading, orphanedIds, updateColor, updateNote, remove } =
    useHighlights();

  if (loading) {
    return (
      <div className="rw-notes-panel">
        <p className="muted" style={{ fontSize: "var(--text-sm)", margin: 0 }}>
          Loading…
        </p>
      </div>
    );
  }

  if (highlights.length === 0) {
    return (
      <div className="rw-notes-panel">
        <EmptyState
          icon={Highlighter}
          title="No highlights yet"
          description="Select any text in the article to highlight it or add a note. Your highlights show up here."
          className="border-0 bg-transparent py-[var(--space-7)]"
        />
      </div>
    );
  }

  return (
    <div className="rw-notes-panel">
      <div className="rw-notes-panel-header">
        <h3 className="rw-notes-panel-title">Highlights &amp; notes</h3>
        <Badge variant="neutral">{highlights.length}</Badge>
      </div>

      {highlights.map((hl) => (
        <NoteRow
          key={hl.id}
          highlight={hl}
          isOrphaned={orphanedIds.has(hl.id)}
          onUpdateColor={(color) => void updateColor(hl.id, color)}
          onUpdateNote={(note) => void updateNote(hl.id, note)}
          onDelete={() => remove(hl.id)}
        />
      ))}
    </div>
  );
}

export { HIGHLIGHT_COLORS };
