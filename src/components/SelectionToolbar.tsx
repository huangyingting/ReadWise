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

import { useRef, useEffect, useCallback } from "react";
import { Highlighter, StickyNote, BookText, Check, Languages } from "lucide-react";
import { cn, focusRing } from "@/lib/cn";
import type { HighlightColor } from "./ReaderHighlightsProvider";

const TOOLBAR_HEIGHT = 48; // approximate; see CSS .rw-sel-toolbar
const MINI_PLAYER_HEIGHT = 56;

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
  onColorChange: (c: HighlightColor) => void;
  onHighlight: () => void;
  onAddNote: () => void;
  /** Opens the sentence translation popover for the current selection. */
  onTranslate: () => void;
  onDefine: () => void;
  onClose: () => void;
  /** Ref guard: outside-click should ignore this element (the toolbar itself). */
  toolbarRef: React.RefObject<HTMLDivElement | null>;
}

export default function SelectionToolbar({
  selectionRect,
  color,
  showDefine,
  onColorChange,
  onHighlight,
  onAddNote,
  onTranslate,
  onDefine,
  onClose,
  toolbarRef,
}: SelectionToolbarProps) {
  // We use a measured width to center; approximate first render, exact after
  const innerRef = useRef<HTMLDivElement>(null);

  // Compute position after mount (when we know the rendered width)
  // We set inline styles directly for performance
  useEffect(() => {
    const el = innerRef.current;
    if (!el) return;

    const W = el.offsetWidth || 260;
    const rect = selectionRect;
    const centerX = rect.left + rect.width / 2;

    // Horizontal: center on selection, clamp into viewport
    const left = Math.max(12, Math.min(centerX - W / 2, window.innerWidth - W - 12));

    // Vertical: prefer above the selection
    const aboveY = rect.top - TOOLBAR_HEIGHT - 8;
    const belowY = rect.bottom + 8;
    const miniPlayerBand = window.innerHeight - MINI_PLAYER_HEIGHT - TOOLBAR_HEIGHT - 12;

    let top: number;
    if (aboveY < 12) {
      // Can't go above — use below
      top = belowY;
    } else if (belowY > miniPlayerBand) {
      // Below would land on the mini-player — force above
      top = aboveY;
    } else {
      top = aboveY;
    }
    top = Math.max(12, top);

    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }, [selectionRect]);

  // Tab focus management: left/right arrow for swatches (roving tabindex)
  const swatchGroupRef = useRef<HTMLDivElement>(null);

  const handleSwatchKey = useCallback(
    (e: React.KeyboardEvent, index: number) => {
      const group = swatchGroupRef.current;
      if (!group) return;
      const btns = Array.from(group.querySelectorAll<HTMLButtonElement>("button"));
      if (e.key === "ArrowRight") {
        e.preventDefault();
        const next = (index + 1) % btns.length;
        btns[next]?.focus();
        onColorChange(SWATCH_COLORS[next].color);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        const prev = (index - 1 + btns.length) % btns.length;
        btns[prev]?.focus();
        onColorChange(SWATCH_COLORS[prev].color);
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    },
    [onColorChange, onClose],
  );

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
      style={{ left: 0, top: 0 }} // overridden by the useEffect above
      onMouseUp={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* Swatch group */}
      <div
        ref={swatchGroupRef}
        role="radiogroup"
        aria-label="Highlight color"
        className="rw-sel-swatch-group"
      >
        {SWATCH_COLORS.map(({ color: c, label, cssVar }, i) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={color === c}
            aria-label={label}
            tabIndex={color === c ? 0 : -1}
            className={cn("rw-sel-swatch", focusRing)}
            style={{ backgroundColor: cssVar }}
            onClick={() => onColorChange(c)}
            onKeyDown={(e) => handleSwatchKey(e, i)}
          >
            {color === c ? (
              <Check size={12} aria-hidden="true" style={{ color: "rgba(0,0,0,0.6)" }} />
            ) : null}
          </button>
        ))}
      </div>

      <div className="rw-sel-toolbar-divider" aria-hidden="true" />

      {/* Highlight action */}
      <button
        type="button"
        className={cn("rw-sel-toolbar-btn", focusRing)}
        onClick={onHighlight}
        onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); onClose(); } }}
      >
        <Highlighter size={14} aria-hidden="true" />
        Highlight
      </button>

      {/* Translate — always shown when the toolbar is open */}
      <button
        type="button"
        className={cn("rw-sel-toolbar-btn", focusRing)}
        onClick={onTranslate}
        onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); onClose(); } }}
      >
        <Languages size={14} aria-hidden="true" />
        Translate
      </button>

      {/* Add note */}
      <button
        type="button"
        className={cn("rw-sel-toolbar-btn", focusRing)}
        onClick={onAddNote}
        onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); onClose(); } }}
      >
        <StickyNote size={14} aria-hidden="true" />
        Add note
      </button>

      {/* Define — single word only */}
      {showDefine ? (
        <button
          type="button"
          className={cn("rw-sel-toolbar-btn", focusRing)}
          onClick={onDefine}
          onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); onClose(); } }}
        >
          <BookText size={14} aria-hidden="true" />
          Define
        </button>
      ) : null}
    </div>
  );
}

export { SWATCH_COLORS };
