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

import { useCallback, useRef, useEffect, useState } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  Button,
  HighlightColorSwatchGroup,
  IconButton,
  Textarea,
  isHighlightColor,
} from "@/components/ui";
import { useFocusTrap } from "@/lib/focus-trap";
import ConfirmAction from "@/components/ConfirmAction";
import { usePopoverPosition } from "@/lib/use-popover-position";
import type { Highlight, HighlightColor } from "@/components/ReaderHighlightsProvider";

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

function noteCounterToneClass(nearLimit: boolean, atLimit: boolean): string {
  if (atLimit) return "at-limit";
  if (nearLimit) return "near-limit";
  return "";
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
  const selectedSwatchRef = useRef<HTMLButtonElement>(null);

  const [noteText, setNoteText] = useState(highlight.note ?? "");
  const [noteOpen, setNoteOpen] = useState(!!highlight.note);
  const [deleting, setDeleting] = useState(false);

  const setPopoverElement = useCallback(
    (el: HTMLDivElement | null) => {
      (innerRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
      (popoverRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
    },
    [popoverRef],
  );

  // Sync note text when highlight changes externally
  useEffect(() => {
    setNoteText(highlight.note ?? "");
  }, [highlight.note]);

  useFocusTrap(innerRef, true, onClose, {
    initialFocusRef: selectedSwatchRef,
    stopEscapePropagation: true,
  });

  // Position the popover — anchor is the bounding rect of the <mark> element
  usePopoverPosition(innerRef, anchorEl.getBoundingClientRect(), {
    placement: "above",
    estimatedHeight: POPOVER_HEIGHT,
    deps: [anchorEl],
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

  const handleDelete = useCallback(async () => {
    setDeleting(true);
    try {
      await onDelete();
      onClose();
    } finally {
      setDeleting(false);
    }
  }, [onClose, onDelete]);

  const currentColor = isHighlightColor(highlight.color) ? highlight.color : "yellow";
  const noteLen = noteText.length;
  const nearLimit = noteLen > NOTE_MAX * 0.85;
  const atLimit = noteLen >= NOTE_MAX;
  const showNoteCounter = nearLimit || atLimit;

  return (
    <div
      ref={setPopoverElement}
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
        <HighlightColorSwatchGroup
          value={currentColor}
          onChange={onColorChange}
          onEscape={onClose}
          activeSwatchRef={selectedSwatchRef}
          className="rw-hl-popover-swatch-row"
        />
        <IconButton
          size="sm"
          context="reading"
          className="rw-hl-popover-close"
          aria-label="Close"
          onClick={onClose}
        >
          <X size={16} />
        </IconButton>
      </div>

      {/* Body: note editor */}
      <div className="rw-hl-popover-body">
        {noteOpen ? (
          <div className="rw-note-inline-edit">
            <Textarea
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
            {showNoteCounter && (
              <p
                className={cn(
                  "rw-note-counter",
                  noteCounterToneClass(nearLimit, atLimit),
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
          <Button
            variant="ghost"
            size="sm"
            className="rw-note-row-add-note"
            onClick={() => setNoteOpen(true)}
          >
            {highlight.note ? "Edit note" : "Add note…"}
          </Button>
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
          onConfirm={handleDelete}
        />
      </div>
    </div>
  );
}
