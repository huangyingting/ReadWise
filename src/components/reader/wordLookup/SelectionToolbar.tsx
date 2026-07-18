"use client";

/**
 * SelectionToolbar (M11)
 *
 * Compact horizontal pill that appears when the user drag-selects text in the
 * reader prose. Shows 4 color swatches + Highlight + Add note actions.
 * "Define" appears only when exactly one word is selected.
 *
 * Positioning mirrors WordLookup's clamp/flip/mini-player guard:
 *  - Default: above the selection rect
 *  - Flip below if top would go off-screen or behind ReaderProgress bar
 *  - Mini-player guard: never overlap the z-40 transport band
 *  - Horizontal: centered on selection, clamped with 12px gutters
 *  - Keyboard: focus enters the active swatch, Tab wraps inside the toolbar,
 *    and Escape closes back to the reader selection context.
 */

import { useRef } from "react";
import {
  Highlighter,
  StickyNote,
  BookText,
  Languages,
  BookMarked,
} from "lucide-react";
import { IconButton } from "@/components/ui/IconButton";
import { HighlightColorSwatchGroup } from "@/components/ui";
import type { HighlightColor } from "@/components/ReaderHighlightsProvider";
import { ReaderFloatingSurface } from "@/components/reader/ReaderFloatingSurface";

const ACTION_BUTTON_CLASS =
  "w-auto px-[var(--space-2)] gap-1 text-[length:var(--text-sm)] font-semibold whitespace-nowrap active:translate-y-px text-primary-text hover:bg-[color-mix(in_srgb,var(--primary)_12%,transparent)]";

interface SelectionToolbarProps {
  /** Bounding rect of the selection (from range.getBoundingClientRect()). */
  selectionRect: DOMRect;
  /** Currently active color. */
  color: HighlightColor;
  /** Whether "Define" should be shown (only when exactly one word selected). */
  showDefine: boolean;
  /** Whether "Grammar" should be shown (2–5 words selected). */
  showGrammar: boolean;
  onColorChange: (c: HighlightColor) => void;
  onHighlight: () => void;
  onAddNote: () => void;
  /** Opens the sentence translation popover for the current selection. */
  onTranslate: () => void;
  onDefine: () => void;
  onGrammar: () => void;
  onClose: () => void;
  /** Ref guard: outside-click should ignore this element (the toolbar itself). */
  toolbarRef: React.RefObject<HTMLDivElement | null>;
}

export default function SelectionToolbar({
  selectionRect,
  color,
  showDefine,
  showGrammar,
  onColorChange,
  onHighlight,
  onAddNote,
  onTranslate,
  onDefine,
  onGrammar,
  onClose,
  toolbarRef,
}: SelectionToolbarProps) {
  const selectedSwatchRef = useRef<HTMLButtonElement>(null);

  return (
    <ReaderFloatingSurface
      ref={toolbarRef}
      anchor={selectionRect}
      placement="above"
      role="toolbar"
      label="Text actions"
      onClose={onClose}
      initialFocusRef={selectedSwatchRef}
      className="rw-sel-toolbar"
    >
      <HighlightColorSwatchGroup
        value={color}
        onChange={onColorChange}
        onEscape={onClose}
        size="sm"
        activeSwatchRef={selectedSwatchRef}
        className="rw-sel-swatch-group"
      />

      <div className="rw-sel-toolbar-divider" aria-hidden="true" />

      {/* Highlight action */}
      <IconButton
        className={ACTION_BUTTON_CLASS}
        onClick={onHighlight}
      >
        <Highlighter size={14} aria-hidden="true" />
        Highlight
      </IconButton>

      {/* Translate — always shown when the toolbar is open */}
      <IconButton
        className={ACTION_BUTTON_CLASS}
        onClick={onTranslate}
      >
        <Languages size={14} aria-hidden="true" />
        Translate
      </IconButton>

      {/* Add note */}
      <IconButton
        className={ACTION_BUTTON_CLASS}
        onClick={onAddNote}
      >
        <StickyNote size={14} aria-hidden="true" />
        Add note
      </IconButton>

      {/* Define — single word only */}
      {showDefine ? (
        <IconButton
          className={ACTION_BUTTON_CLASS}
          onClick={onDefine}
        >
          <BookText size={14} aria-hidden="true" />
          Define
        </IconButton>
      ) : null}

      {/* Grammar — 2–5 word phrases */}
      {showGrammar ? (
        <IconButton
          className={ACTION_BUTTON_CLASS}
          onClick={onGrammar}
        >
          <BookMarked size={14} aria-hidden="true" />
          Grammar
        </IconButton>
      ) : null}
    </ReaderFloatingSurface>
  );
}
