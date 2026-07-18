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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  Button,
  HighlightColorSwatchGroup,
  IconButton,
  Textarea,
  isHighlightColor,
} from "@/components/ui";
import { ReaderFloatingSurface } from "@/components/reader/ReaderFloatingSurface";
import ConfirmAction from "@/components/ConfirmAction";
import type { Highlight, HighlightColor } from "@/components/ReaderHighlightsProvider";

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
  const selectedSwatchRef = useRef<HTMLButtonElement>(null);
  const anchorRef = useMemo<React.RefObject<HTMLElement | null>>(
    () => ({ current: anchorEl }),
    [anchorEl],
  );

  const [noteText, setNoteText] = useState(highlight.note ?? "");
  const [noteOpen, setNoteOpen] = useState(!!highlight.note);
  const [deleting, setDeleting] = useState(false);

  // Sync note text when highlight changes externally
  useEffect(() => {
    setNoteText(highlight.note ?? "");
  }, [highlight.note]);

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
    <ReaderFloatingSurface
      ref={popoverRef}
      anchor={anchorRef}
      placement="above"
      label="Edit highlight"
      onClose={onClose}
      initialFocusRef={selectedSwatchRef}
      className="rw-hl-popover"
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
    </ReaderFloatingSurface>
  );
}
