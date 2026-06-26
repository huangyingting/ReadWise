"use client";

/**
 * usePopoverPosition — shared viewport-clamp / flip logic for all reader
 * popovers (SelectionToolbar, HighlightEditPopover, SentenceTranslatePopover,
 * GrammarPopover, DictionaryPopover).
 *
 * Sets `el.style.left` and `el.style.top` (fixed positioning assumed).
 * Optionally clamps `el.style.maxHeight` so the popover never overlaps the
 * mini-player transport band.
 */

import { useLayoutEffect } from "react";
import type React from "react";

// ─── Single source of truth ───────────────────────────────────────────────────

/** Height of the mini-player transport band (z-40) at the bottom of the viewport. */
export const MINI_PLAYER_HEIGHT = 56;

// ─── Types ────────────────────────────────────────────────────────────────────

/** Rectangle anchor — typically a DOMRect from a selection or mark element. */
type RectAnchor = {
  left: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
};

/** Point anchor — a raw click / tap coordinate. */
type PointAnchor = { x: number; y: number };

/** Union accepted by usePopoverPosition. */
export type AnchorPoint = RectAnchor | PointAnchor;

function isRectAnchor(a: AnchorPoint): a is RectAnchor {
  return "left" in a;
}

export interface PopoverPositionOpts {
  /**
   * Preferred placement relative to the anchor.
   *
   * - `"above"` — centre horizontally over the anchor rect, prefer above,
   *   flip below only when there is no room above.
   * - `"below"` (default) — anchor at the bottom-left (DOMRect) or the click
   *   point ({x,y}), prefer below, flip above when needed.
   */
  placement?: "above" | "below";
  /** Fallback element height used when `offsetHeight` is 0. @default 200 */
  estimatedHeight?: number;
  /** Fallback element width used when `offsetWidth` is 0. @default 300 */
  estimatedWidth?: number;
  /** Gap in px between the anchor edge and the popover edge. @default 8 */
  gap?: number;
  /** Minimum distance in px from every viewport edge. @default 12 */
  gutter?: number;
  /**
   * When `true`, also sets `el.style.maxHeight` so the popover cannot extend
   * below the mini-player band.
   */
  setMaxHeight?: boolean;
  /**
   * React dependency list forwarded to the internal `useLayoutEffect`.
   * The effect re-runs whenever these values change.
   * Pass `undefined` to run after every render (same as omitting the deps
   * array in a plain `useLayoutEffect` call).
   */
  deps?: React.DependencyList;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Positions a floating element relative to an anchor point, clamped within the
 * safe viewport area (above the mini-player, inside the gutter).
 */
export function usePopoverPosition(
  elRef: React.RefObject<HTMLElement | null>,
  anchor: AnchorPoint | null,
  opts: PopoverPositionOpts = {},
): void {
  const {
    placement = "below",
    estimatedHeight = 200,
    estimatedWidth = 300,
    gap = 8,
    gutter = 12,
    setMaxHeight: doSetMaxHeight = false,
    deps,
  } = opts;

  useLayoutEffect(
    () => {
      const el = elRef.current;
      if (!el || !anchor) return;

      const vw = window.innerWidth;
      const vh = window.innerHeight;

      if (doSetMaxHeight) {
        el.style.maxHeight = `${vh - MINI_PLAYER_HEIGHT - 2 * gutter}px`;
      }

      const pw = el.offsetWidth || estimatedWidth;
      const ph = el.offsetHeight || estimatedHeight;

      let left: number;
      let top: number;

      if (isRectAnchor(anchor)) {
        if (placement === "above") {
          // Centre horizontally over the anchor rect; prefer above, flip below.
          const cx = anchor.left + anchor.width / 2;
          left = Math.max(gutter, Math.min(cx - pw / 2, vw - pw - gutter));
          const aboveY = anchor.top - ph - gap;
          const belowY = anchor.bottom + gap;
          top = aboveY < gutter ? belowY : aboveY;
        } else {
          // Anchor to bottom-left of the rect; prefer below, flip above.
          left = Math.max(gutter, Math.min(anchor.left, vw - pw - gutter));
          const safeBottom = vh - MINI_PLAYER_HEIGHT - ph - gutter;
          top =
            anchor.bottom > safeBottom
              ? Math.max(gutter, anchor.top - ph - gap)
              : anchor.bottom + gap;
        }
      } else {
        // Point anchor: centre horizontally, prefer below, flip above.
        left = Math.max(gutter, Math.min(anchor.x - pw / 2, vw - pw - gutter));
        const safeBottom = vh - MINI_PLAYER_HEIGHT - gutter;
        top = anchor.y + gap;
        if (top + ph > safeBottom) top = anchor.y - ph - gap;
        top = Math.min(top, safeBottom - ph);
      }

      top = Math.max(gutter, top);
      el.style.left = `${left}px`;
      el.style.top = `${top}px`;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    deps,
  );
}
