"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { nextNavIndex, type NavKey } from "./command-navigation";
import type { SelectableItem } from "./command-items";

export interface UseCommandNavigationOptions {
  items: SelectableItem[];
  onClose: () => void;
  onActivate: (item: SelectableItem) => void;
  listboxRef: React.RefObject<HTMLUListElement | null>;
  panelRef: React.RefObject<HTMLDivElement | null>;
}

export interface UseCommandNavigationResult {
  activeIndex: number;
  setActiveIndex: React.Dispatch<React.SetStateAction<number>>;
}

/**
 * Manages keyboard navigation for the command palette:
 * - ArrowDown / ArrowUp / Home / End: move active index (with wraparound).
 * - Enter: activate the current item.
 * - Escape: close the palette.
 * - Tab / Shift+Tab: cycle focus between the input and the mobile close button
 *   (focus trap within the panel).
 *
 * Uses stale-closure-safe refs so the keydown listener is only re-registered
 * when structural dependencies change, not on every render.
 */
export function useCommandNavigation({
  items,
  onClose,
  onActivate,
  listboxRef,
  panelRef,
}: UseCommandNavigationOptions): UseCommandNavigationResult {
  const [activeIndex, setActiveIndex] = useState(0);

  // Keep stale-closure-safe refs so the event listener always sees current values.
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const activeIndexRef = useRef(activeIndex);
  activeIndexRef.current = activeIndex;

  const scrollActiveIntoView = useCallback(
    (index: number) => {
      if (!listboxRef.current) return;
      const id = itemsRef.current[index]?.ariaId;
      if (!id) return;
      const el = listboxRef.current.querySelector<HTMLElement>(`[id="${id}"]`);
      el?.scrollIntoView({ block: "nearest" });
    },
    [listboxRef],
  );

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      switch (e.key) {
        case "Escape":
          e.preventDefault();
          onClose();
          break;

        case "ArrowDown":
        case "ArrowUp":
        case "Home":
        case "End": {
          e.preventDefault();
          const len = itemsRef.current.length;
          const next = nextNavIndex(activeIndexRef.current, len, e.key as NavKey);
          setActiveIndex(next);
          scrollActiveIntoView(next);
          break;
        }

        case "Enter": {
          e.preventDefault();
          const current = itemsRef.current[activeIndexRef.current];
          if (current) onActivate(current);
          break;
        }

        case "Tab": {
          // Focus trap: cycle between the input and the mobile close button.
          if (!panelRef.current) break;
          const focusable = Array.from(
            panelRef.current.querySelectorAll<HTMLElement>(
              'input, button:not([disabled]), [tabindex]:not([tabindex="-1"])',
            ),
          );
          if (focusable.length <= 1) {
            e.preventDefault();
            break;
          }
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
          break;
        }
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose, onActivate, scrollActiveIntoView, panelRef]);

  return { activeIndex, setActiveIndex };
}
