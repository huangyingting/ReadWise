"use client";

/**
 * HighlightEditPopover (M11)
 *
 * Appears when the user clicks a <mark.rw-hl> in the reader prose.
 * Contains:
 *  - Color swatch radiogroup (change highlight color)
 *  - Note textarea (add/edit note, 2000 char cap)
 *  - M8 ConfirmAction delete (danger)
 *
 * Positioning mirrors the SelectionToolbar clamp/flip/mini-player logic.
 */

import { useRef, useEffect, useState } from "react";
import { X, Check } from "lucide-react";
import { cn, focusRing } from "@/lib/cn";
import { Button } from "@/components/ui/Button";
import { useRovingTabindex } from "@/lib/use-roving-tabindex";
import ConfirmAction from "@/components/ConfirmAction";
import { usePopoverPosition } from "@/lib/use-popover-position";
import type { Highlight, HighlightColor } from "./ReaderHighlightsProvider";
import { SWATCH_COLORS } from "./SelectionToolbar";

const POPOVER_HEIGHT = 260; // approximate
const NOTE_MAX = 2000;

interface HighlightEditPopoverProps {
  highlight: Highlight;
  /** The <mark> element this popover is anchored to. */
  anchorEl: HTMLElement;
  onClose: () => void;
  onColorChange: (color: HighlightColor) => void;
  onNoteSave: (note: string | null) => void;
  onDelete: () => Promise<void>;
  /** Ref guard so outside-click ignores this element. */
  popoverRef: React.RefObject<HTMLDivElement | null>;
}

export default function HighlightEditPopover({
  highlight,
  anchorEl,
  onClose,
  onColorChange,
  onNoteSave,
  onDelete,
  popoverRef,
}: HighlightEditPopoverProps) {
  const innerRef = useRef<HTMLDivElement>(null);
  const firstFocusRef = useRef<HTMLButtonElement>(null);

  const [noteText, setNoteText] = useState(highlight.note ?? "");
  const [noteOpen, setNoteOpen] = useState(!!highlight.note);
  const [deleting, setDeleting] = useState(false);

  // Sync note text when highlight changes externally
  useEffect(() => {
    setNoteText(highlight.note ?? "");
  }, [highlight.note]);

  // Focus first swatch on open
  useEffect(() => {
    requestAnimationFrame(() => firstFocusRef.current?.focus());
  }, []);

  // Position the popover — anchor is the bounding rect of the <mark> element
  usePopoverPosition(innerRef, anchorEl.getBoundingClientRect(), {
    placement: "above",
    estimatedHeight: POPOVER_HEIGHT,
    deps: [anchorEl],
  });

  // Swatch arrow-key navigation
  const swatchGroupRef = useRef<HTMLDivElement>(null);
  const { handleKeyDown: handleSwatchKey } = useRovingTabindex(swatchGroupRef, {
    selector: "button",
    onNavigate: (i) => onColorChange(SWATCH_COLORS[i].color),
    onEscape: onClose,
  });

  function handleNoteSave() {
    const trimmed = noteText.trim();
    onNoteSave(trimmed || null);
    setNoteOpen(false);
  }

  function handleNoteCancel() {
    setNoteText(highlight.note ?? "");
    setNoteOpen(false);
  }

  const currentColor = (highlight.color as HighlightColor | null) ?? "yellow";
  const noteLen = noteText.length;
  const nearLimit = noteLen > NOTE_MAX * 0.85;
  const atLimit = noteLen >= NOTE_MAX;

  return (
    <div
      ref={(el) => {
        (innerRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
        (popoverRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
      }}
      role="dialog"
      aria-label="Edit highlight"
      className="rw-hl-popover"
      style={{ left: 0, top: 0 }}
      onMouseUp={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onClose();
          anchorEl.focus?.();
        }
      }}
    >
      {/* Header: swatches + close */}
      <div className="rw-hl-popover-header">
        <div
          ref={swatchGroupRef}
          role="radiogroup"
          aria-label="Highlight color"
          className="rw-hl-popover-swatch-row"
        >
          {SWATCH_COLORS.map(({ color: c, label, cssVar }, i) => (
            <button
              key={c}
              ref={i === 0 ? firstFocusRef : undefined}
              type="button"
              role="radio"
              aria-checked={currentColor === c}
              aria-label={label}
              tabIndex={currentColor === c ? 0 : -1}
              className={cn("rw-hl-popover-swatch", focusRing)}
              style={{ backgroundColor: cssVar }}
              onClick={() => onColorChange(c)}
              onKeyDown={(e) => handleSwatchKey(e, i)}
            >
              {currentColor === c ? (
                <Check size={12} aria-hidden="true" style={{ color: "var(--reading-text)" }} />
              ) : null}
            </button>
          ))}
        </div>
        <button
          type="button"
          className={cn("rw-hl-popover-close", focusRing)}
          aria-label="Close"
          onClick={onClose}
        >
          <X size={16} />
        </button>
      </div>

      {/* Body: note editor */}
      <div className="rw-hl-popover-body">
        {noteOpen ? (
          <div className="rw-note-inline-edit">
            <textarea
              className="rw-note-input"
              value={noteText}
              maxLength={NOTE_MAX}
              rows={3}
              placeholder="Add a note…"
              aria-label="Highlight note"
              onChange={(e) => setNoteText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  handleNoteCancel();
                }
              }}
              // Auto-focus when note editor opens
              autoFocus
            />
            {(nearLimit || atLimit) && (
              <p
                className={cn(
                  "rw-note-counter",
                  atLimit ? "at-limit" : nearLimit ? "near-limit" : "",
                )}
              >
                {noteLen}/{NOTE_MAX}
              </p>
            )}
            <div className="rw-note-inline-actions">
              <Button size="sm" onClick={handleNoteSave} disabled={atLimit && noteLen > NOTE_MAX}>
                Save
              </Button>
              <Button size="sm" variant="ghost" onClick={handleNoteCancel}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="rw-note-row-add-note"
            onClick={() => setNoteOpen(true)}
          >
            {highlight.note ? "Edit note" : "Add note…"}
          </button>
        )}
      </div>

      {/* Footer: delete */}
      <div className="rw-hl-popover-footer">
        <ConfirmAction
          triggerLabel="Delete highlight"
          triggerVariant="danger"
          size="sm"
          confirmMessage="Delete this highlight and its note?"
          loading={deleting}
          onConfirm={async () => {
            setDeleting(true);
            try {
              await onDelete();
              onClose();
            } finally {
              setDeleting(false);
            }
          }}
        />
      </div>
    </div>
  );
}
