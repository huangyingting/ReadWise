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
import type { DependencyList, RefObject } from "react";

// ─── Single source of truth ───────────────────────────────────────────────────

/** Height of the mini-player transport band (z-40) at the bottom of the viewport. */
export const MINI_PLAYER_HEIGHT = 56;
const DEFAULT_ESTIMATED_HEIGHT = 200;
const DEFAULT_ESTIMATED_WIDTH = 300;
const DEFAULT_GAP = 8;
const DEFAULT_GUTTER = 12;

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

type PopoverMetrics = {
  viewportWidth: number;
  viewportHeight: number;
  popoverWidth: number;
  popoverHeight: number;
  gap: number;
  gutter: number;
};

type PopoverPosition = { left: number; top: number };

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
  deps?: DependencyList;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

function safeBottom(metrics: PopoverMetrics, includePopoverHeight: boolean): number {
  return (
    metrics.viewportHeight -
    MINI_PLAYER_HEIGHT -
    metrics.gutter -
    (includePopoverHeight ? metrics.popoverHeight : 0)
  );
}

function positionRectAnchor(
  anchor: RectAnchor,
  placement: "above" | "below",
  metrics: PopoverMetrics,
): PopoverPosition {
  const { viewportWidth, popoverWidth, popoverHeight, gap, gutter } = metrics;

  if (placement === "above") {
    const cx = anchor.left + anchor.width / 2;
    const left = clamp(cx - popoverWidth / 2, gutter, viewportWidth - popoverWidth - gutter);
    const aboveY = anchor.top - popoverHeight - gap;
    const belowY = anchor.bottom + gap;
    return { left, top: aboveY < gutter ? belowY : aboveY };
  }

  const left = clamp(anchor.left, gutter, viewportWidth - popoverWidth - gutter);
  const top =
    anchor.bottom > safeBottom(metrics, true)
      ? Math.max(gutter, anchor.top - popoverHeight - gap)
      : anchor.bottom + gap;
  return { left, top };
}

function positionPointAnchor(anchor: PointAnchor, metrics: PopoverMetrics): PopoverPosition {
  const { viewportWidth, popoverWidth, popoverHeight, gap, gutter } = metrics;
  const left = clamp(anchor.x - popoverWidth / 2, gutter, viewportWidth - popoverWidth - gutter);
  const bottom = safeBottom(metrics, false);
  let top = anchor.y + gap;
  if (top + popoverHeight > bottom) top = anchor.y - popoverHeight - gap;
  top = Math.min(top, bottom - popoverHeight);
  return { left, top };
}

function computePopoverPosition(
  anchor: AnchorPoint,
  placement: "above" | "below",
  metrics: PopoverMetrics,
): PopoverPosition {
  const position = isRectAnchor(anchor)
    ? positionRectAnchor(anchor, placement, metrics)
    : positionPointAnchor(anchor, metrics);

  return {
    left: position.left,
    top: Math.max(metrics.gutter, position.top),
  };
}

/**
 * Positions a floating element relative to an anchor point, clamped within the
 * safe viewport area (above the mini-player, inside the gutter).
 */
export function usePopoverPosition(
  elRef: RefObject<HTMLElement | null>,
  anchor: AnchorPoint | null,
  opts: PopoverPositionOpts = {},
): void {
  const {
    placement = "below",
    estimatedHeight = DEFAULT_ESTIMATED_HEIGHT,
    estimatedWidth = DEFAULT_ESTIMATED_WIDTH,
    gap = DEFAULT_GAP,
    gutter = DEFAULT_GUTTER,
    setMaxHeight: doSetMaxHeight = false,
    deps,
  } = opts;

  useLayoutEffect(
    () => {
      const el = elRef.current;
      if (!el || !anchor) return;

      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      if (doSetMaxHeight) {
        el.style.maxHeight = `${viewportHeight - MINI_PLAYER_HEIGHT - 2 * gutter}px`;
      }

      const { left, top } = computePopoverPosition(anchor, placement, {
        viewportWidth,
        viewportHeight,
        popoverWidth: el.offsetWidth || estimatedWidth,
        popoverHeight: el.offsetHeight || estimatedHeight,
        gap,
        gutter,
      });
      el.style.left = `${left}px`;
      el.style.top = `${top}px`;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    deps,
  );
}
