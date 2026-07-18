"use client";

/**
 * Roving tabindex helpers (#515 — REF-078).
 *
 * Provides a hook for arrow-key navigation within a group of related controls
 * (tab bars, color swatch groups, segmented controls, listbox-like options).
 * Each child in the group is focusable exactly when it is the "active" item,
 * and arrow keys move focus to the previous or next enabled item.
 *
 */

import { useCallback, useRef } from "react";
import type { RefObject } from "react";

const DEFAULT_SELECTOR = "button";

export type RovingOrientation = "horizontal" | "vertical" | "both";

type RovingIndexOptions = {
  orientation?: RovingOrientation;
  homeEnd?: boolean;
};

type RovingKeyboardEvent = {
  key: string;
  currentTarget?: EventTarget | null;
  defaultPrevented?: boolean;
  preventDefault: () => void;
};

function isForwardKey(key: string, orientation: RovingOrientation): boolean {
  return (
    ((orientation === "horizontal" || orientation === "both") &&
      key === "ArrowRight") ||
    ((orientation === "vertical" || orientation === "both") &&
      key === "ArrowDown")
  );
}

function isBackwardKey(key: string, orientation: RovingOrientation): boolean {
  return (
    ((orientation === "horizontal" || orientation === "both") &&
      key === "ArrowLeft") ||
    ((orientation === "vertical" || orientation === "both") &&
      key === "ArrowUp")
  );
}

// ---------------------------------------------------------------------------
// Pure helper (testable without DOM)
// ---------------------------------------------------------------------------

/**
 * Compute the next roving-tabindex item index given a keyboard event key,
 * the current index, and the total number of items.
 *
 * Returns null when the key is not a navigation key.
 */
function computeRovingIndex(
  key: string,
  current: number,
  total: number,
  options: RovingIndexOptions = {},
): number | null {
  if (total === 0) return null;
  const { orientation = "horizontal", homeEnd = false } = options;

  if (isForwardKey(key, orientation)) {
    return (current + 1) % total;
  }
  if (isBackwardKey(key, orientation)) {
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
  /** Arrow-key orientation. Defaults to horizontal. */
  orientation?: RovingOrientation;
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
 * Returns a stable `handleKeyDown` function for roving-tabindex navigation.
 * Mount it directly on each item; the module discovers the active item and
 * updates focus and tabindex state:
 *
 * ```tsx
 * const { handleKeyDown } = useRovingTabindex(containerRef, {
 *   orientation: "both",
 *   homeEnd: true,
 *   onNavigate: (i) => activate(TABS[i].id),
 * });
 *
 * // Inside the render:
 * items.map((item, i) => (
 *   <button
 *     tabIndex={active === item.id ? 0 : -1}
 *     onKeyDown={handleKeyDown}
 *   >
 *     {item.label}
 *   </button>
 * ))
 * ```
 */
export function useRovingTabindex(
  containerRef: RefObject<HTMLElement | null>,
  options: RovingTabindexOptions = {},
): {
  handleKeyDown: (event: RovingKeyboardEvent) => void;
} {
  const {
    selector = DEFAULT_SELECTOR,
    orientation = "horizontal",
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
    (event: RovingKeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === "Escape") {
        if (onEscapeRef.current) {
          event.preventDefault();
          onEscapeRef.current();
        }
        return;
      }

      const container = containerRef.current;
      if (!container) return;
      const items = Array.from(
        container.querySelectorAll<HTMLElement>(selector),
      );
      const enabledItems = items.filter(
        (item) =>
          !(item as HTMLButtonElement).disabled &&
          item.getAttribute("aria-disabled") !== "true",
      );
      const eventTarget = event.currentTarget as HTMLElement | undefined;
      const activeElement = eventTarget && enabledItems.includes(eventTarget)
        ? eventTarget
        : typeof document === "undefined"
          ? null
          : document.activeElement;
      const currentIndex = enabledItems.indexOf(activeElement as HTMLElement);
      const nextIndex = computeRovingIndex(
        event.key,
        currentIndex,
        enabledItems.length,
        { orientation, homeEnd },
      );
      if (nextIndex === null) return;

      const nextItem = enabledItems[nextIndex];
      if (!nextItem) return;
      event.preventDefault();
      for (const item of items) item.tabIndex = item === nextItem ? 0 : -1;
      nextItem.focus();
      onNavigateRef.current?.(items.indexOf(nextItem));
    },
    [containerRef, selector, orientation, homeEnd],
  );

  return { handleKeyDown };
}
