"use client";

/**
 * Roving tabindex helpers (#515 — REF-078).
 *
 * Provides a hook for arrow-key navigation within a group of related controls
 * (tab bars, color swatch groups, segmented controls, listbox-like options).
 * Each child in the group is focusable exactly when it is the "active" item
 * (`tabIndex={isActive ? 0 : -1}`), and arrow keys move focus to the previous
 * or next item.
 *
 * A pure `computeRovingIndex` helper is exported for unit tests.
 */

import { useCallback, useRef } from "react";

// ---------------------------------------------------------------------------
// Pure helper (testable without DOM)
// ---------------------------------------------------------------------------

/**
 * Compute the next roving-tabindex item index given a keyboard event key,
 * the current index, and the total number of items.
 *
 * Returns null when the key is not a navigation key.
 */
export function computeRovingIndex(
  key: string,
  current: number,
  total: number,
  options: { vertical?: boolean; homeEnd?: boolean } = {},
): number | null {
  if (total === 0) return null;
  const { vertical = false, homeEnd = false } = options;

  if (key === "ArrowRight" || (vertical && key === "ArrowDown")) {
    return (current + 1) % total;
  }
  if (key === "ArrowLeft" || (vertical && key === "ArrowUp")) {
    return (current - 1 + total) % total;
  }
  if (homeEnd && key === "Home") return 0;
  if (homeEnd && key === "End") return total - 1;
  return null;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface RovingTabindexOptions {
  /**
   * CSS selector used to query child items from the container.
   * Defaults to "button".
   */
  selector?: string;
  /**
   * Also handle ArrowUp / ArrowDown in addition to ArrowLeft / ArrowRight.
   * Set to true for tab bars that support both orientations.
   */
  vertical?: boolean;
  /**
   * Handle Home (jump to first) and End (jump to last) in addition to arrows.
   */
  homeEnd?: boolean;
  /**
   * Called when the active index changes as a result of keyboard navigation.
   * Receives the new index. Use this to sync state that tracks the active item
   * (e.g. `activate(TOOL_TABS[i].id)`).
   */
  onNavigate?: (index: number) => void;
  /**
   * Called when the Escape key is pressed on any item. Typically closes or
   * dismisses the containing widget.
   */
  onEscape?: () => void;
}

/**
 * Returns a stable `handleKeyDown` function for roving-tabindex arrow-key
 * navigation. Mount it on each item:
 *
 * ```tsx
 * const { handleKeyDown } = useRovingTabindex(containerRef, {
 *   vertical: true,
 *   homeEnd: true,
 *   onNavigate: (i) => activate(TABS[i].id),
 * });
 *
 * // Inside the render:
 * items.map((item, i) => (
 *   <button
 *     tabIndex={active === item.id ? 0 : -1}
 *     onKeyDown={(e) => handleKeyDown(e, i)}
 *   >
 *     {item.label}
 *   </button>
 * ))
 * ```
 */
export function useRovingTabindex(
  containerRef: React.RefObject<HTMLElement | null>,
  options: RovingTabindexOptions = {},
): {
  handleKeyDown: (e: React.KeyboardEvent, index: number) => void;
} {
  const {
    selector = "button",
    vertical = false,
    homeEnd = false,
    onNavigate,
    onEscape,
  } = options;

  // Keep callbacks in refs so handleKeyDown is stable even if callbacks change.
  const onNavigateRef = useRef(onNavigate);
  onNavigateRef.current = onNavigate;
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent, index: number) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onEscapeRef.current?.();
        return;
      }

      const container = containerRef.current;
      if (!container) return;
      const items = Array.from(container.querySelectorAll<HTMLElement>(selector));
      const total = items.length;

      const next = computeRovingIndex(e.key, index, total, { vertical, homeEnd });
      if (next === null) return;

      e.preventDefault();
      items[next]?.focus();
      onNavigateRef.current?.(next);
    },
    // containerRef is stable by definition (useRef); include only primitives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selector, vertical, homeEnd],
  );

  return { handleKeyDown };
}
