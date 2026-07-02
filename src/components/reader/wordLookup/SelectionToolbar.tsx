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
 */

import { useRef } from "react";
import { Highlighter, StickyNote, BookText, Check, Languages, BookMarked } from "lucide-react";
import { cn, focusRing } from "@/lib/cn";
import { IconButton } from "@/components/ui/IconButton";
import { useRovingTabindex } from "@/lib/use-roving-tabindex";
import { usePopoverPosition } from "@/lib/use-popover-position";
import type { HighlightColor } from "@/components/ReaderHighlightsProvider";

const TOOLBAR_HEIGHT = 48; // approximate; see CSS .rw-sel-toolbar

const SWATCH_COLORS: { color: HighlightColor; label: string; cssVar: string }[] = [
  { color: "yellow", label: "Yellow", cssVar: "var(--hl-yellow)" },
  { color: "green",  label: "Green",  cssVar: "var(--hl-green)" },
  { color: "blue",   label: "Blue",   cssVar: "var(--hl-blue)" },
  { color: "pink",   label: "Pink",   cssVar: "var(--hl-pink)" },
];

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
  const innerRef = useRef<HTMLDivElement>(null);

  usePopoverPosition(innerRef, selectionRect, {
    placement: "above",
    estimatedHeight: TOOLBAR_HEIGHT,
    deps: [selectionRect],
  });

  // Roving tabindex for color swatches
  const swatchGroupRef = useRef<HTMLDivElement>(null);

  const { handleKeyDown: handleSwatchKey } = useRovingTabindex(swatchGroupRef, {
    selector: "button",
    onNavigate: (i) => onColorChange(SWATCH_COLORS[i].color),
    onEscape: onClose,
  });

  return (
    <div
      ref={(el) => {
        // Merge: store both the inner ref and the outer toolbarRef
        (innerRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
        (toolbarRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
      }}
      role="toolbar"
      aria-label="Text actions"
      className="rw-sel-toolbar"
      style={{ left: 0, top: 0 }} // overridden by usePopoverPosition
      onMouseUp={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        // Single container-level Escape handler. Skip if a child already
        // handled it (e.g. the roving-tabindex swatch group calls onEscape and
        // then e.preventDefault() before the event bubbles here).
        if (e.key === "Escape" && !e.defaultPrevented) {
          e.preventDefault();
          onClose();
        }
      }}
    >
      {/* Swatch group */}
      <div
        ref={swatchGroupRef}
        role="radiogroup"
        aria-label="Highlight color"
        className="rw-sel-swatch-group"
      >
        {SWATCH_COLORS.map(({ color: c, label, cssVar }, i) => (
          <IconButton
            key={c}
            size="sm"
            context="reading"
            role="radio"
            aria-checked={color === c}
            aria-label={label}
            tabIndex={color === c ? 0 : -1}
            className="rw-sel-swatch"
            style={{ backgroundColor: cssVar }}
            onClick={() => onColorChange(c)}
            onKeyDown={(e) => handleSwatchKey(e, i)}
          >
            {color === c ? (
              <Check size={12} aria-hidden="true" style={{ color: "var(--reading-text)" }} />
            ) : null}
          </IconButton>
        ))}
      </div>

      <div className="rw-sel-toolbar-divider" aria-hidden="true" />

      {/* Highlight action */}
      <IconButton
        className="w-auto px-[var(--space-2)] gap-1 text-[length:var(--text-sm)] font-semibold whitespace-nowrap active:translate-y-px text-primary-text hover:bg-[color-mix(in_srgb,var(--primary)_12%,transparent)]"
        onClick={onHighlight}
      >
        <Highlighter size={14} aria-hidden="true" />
        Highlight
      </IconButton>

      {/* Translate — always shown when the toolbar is open */}
      <IconButton
        className="w-auto px-[var(--space-2)] gap-1 text-[length:var(--text-sm)] font-semibold whitespace-nowrap active:translate-y-px text-primary-text hover:bg-[color-mix(in_srgb,var(--primary)_12%,transparent)]"
        onClick={onTranslate}
      >
        <Languages size={14} aria-hidden="true" />
        Translate
      </IconButton>

      {/* Add note */}
      <IconButton
        className="w-auto px-[var(--space-2)] gap-1 text-[length:var(--text-sm)] font-semibold whitespace-nowrap active:translate-y-px text-primary-text hover:bg-[color-mix(in_srgb,var(--primary)_12%,transparent)]"
        onClick={onAddNote}
      >
        <StickyNote size={14} aria-hidden="true" />
        Add note
      </IconButton>

      {/* Define — single word only */}
      {showDefine ? (
        <IconButton
          className="w-auto px-[var(--space-2)] gap-1 text-[length:var(--text-sm)] font-semibold whitespace-nowrap active:translate-y-px text-primary-text hover:bg-[color-mix(in_srgb,var(--primary)_12%,transparent)]"
          onClick={onDefine}
        >
          <BookText size={14} aria-hidden="true" />
          Define
        </IconButton>
      ) : null}

      {/* Grammar — 2–5 word phrases */}
      {showGrammar ? (
        <IconButton
          className="w-auto px-[var(--space-2)] gap-1 text-[length:var(--text-sm)] font-semibold whitespace-nowrap active:translate-y-px text-primary-text hover:bg-[color-mix(in_srgb,var(--primary)_12%,transparent)]"
          onClick={onGrammar}
        >
          <BookMarked size={14} aria-hidden="true" />
          Grammar
        </IconButton>
      ) : null}
    </div>
  );
}

export { SWATCH_COLORS };
