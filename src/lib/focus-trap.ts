/**
 * Shared focus-trap helpers (#210, #515 — REF-078).
 *
 * Exports:
 *  - `getTabbable` — visibility-aware tabbable collector used by modal focus
 *    traps (ReaderToolsSurface, ui/Sheet, useFocusTrap).
 *  - `useFocusTrap` — React hook that installs a Tab/Escape trap on an
 *    element, consolidating the previously-repeated inline implementations in
 *    Sheet and KeyboardShortcutsModal.
 *
 * A single, visibility-aware tabbable collector used by every modal focus trap
 * (ReaderToolsSurface, ui/Sheet). The CSS selector alone is not enough for two
 * reasons:
 *
 *  1. Roving-tabindex widgets (e.g. `SegmentedControl`) render inactive options
 *     as real `<button>`s with `tabindex="-1"`, which the selector still matches.
 *     Including them would make the computed "last focusable" unreachable, so the
 *     Tab-wrap never fires and focus escapes the trap.
 *  2. Always-rendered keep-alive panels (ReaderTools) stay in the DOM while
 *     hidden. Their focusable controls must be excluded or Tab leaks into the
 *     hidden panels and out of the modal.
 *
 * Filter to elements that are genuinely in the tab order (`tabIndex >= 0`) AND
 * currently visible (not inside a `[hidden]` subtree and actually rendered).
 */

const FOCUSABLE_SELECTOR =
  "a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex='-1'])";

/**
 * Whether an element is currently visible: not inside a `[hidden]` subtree and
 * actually rendered (has at least one client rect). `getClientRects()` is empty
 * for `display:none` / `hidden` / detached elements, which is exactly what we
 * want to skip.
 */
function isVisible(el: HTMLElement): boolean {
  if (el.closest("[hidden]")) return false;
  if (el.getClientRects().length === 0) return false;
  return true;
}

/** Collect the genuinely tabbable, visible elements inside `root`. */
export function getTabbable(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  return Array.from(
    root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter((el) => el.tabIndex >= 0 && isVisible(el));
}

// ---------------------------------------------------------------------------
// useFocusTrap — React hook
// ---------------------------------------------------------------------------

import { useEffect, type RefObject } from "react";

export interface FocusTrapOptions {
  /**
   * Use the capture phase. Set to `true` for the topmost overlay so it sees
   * Escape before any background listeners.
   */
  capture?: boolean;
  /**
   * Call `e.stopImmediatePropagation()` on Escape to prevent background
   * overlays from also closing on the same keypress.
   */
  stopEscapePropagation?: boolean;
  /**
   * Restore focus to the element that was active when the trap activated.
   * Set to `true` for overlays that should return focus to their opener
   * (e.g. `Sheet`). Defaults to `false`.
   */
  restoreFocus?: boolean;
  /**
   * Focus this element when the trap activates instead of the first tabbable
   * element inside the container. Use it when a specific control (e.g. a
   * close button) should receive initial focus.
   */
  initialFocusRef?: RefObject<HTMLElement | null>;
}

/**
 * Installs a keyboard focus trap while `active` is true.
 *
 * On activation:
 *  1. Records the currently-focused element (for optional focus restoration).
 *  2. Moves focus to `initialFocusRef` if provided, otherwise to the first
 *     genuinely tabbable element inside `containerRef`, or to `containerRef`
 *     itself as a fallback.
 *  3. Listens for Tab/Shift+Tab to cycle focus within the container and for
 *     Escape to call `onEscape`.
 *
 * On deactivation (active → false or unmount), removes the listener and
 * optionally restores the previously-focused element.
 *
 * @example
 * // Basic sheet/drawer
 * const ref = useRef<HTMLDivElement>(null);
 * useFocusTrap(ref, open, onClose, { restoreFocus: true });
 *
 * // Topmost modal layered over another overlay
 * useFocusTrap(dialogRef, true, onClose, {
 *   capture: true,
 *   stopEscapePropagation: true,
 *   initialFocusRef: closeButtonRef,
 * });
 */
export function useFocusTrap(
  containerRef: RefObject<HTMLElement | null>,
  active: boolean,
  onEscape: () => void,
  options: FocusTrapOptions = {},
): void {
  const {
    capture = false,
    stopEscapePropagation = false,
    restoreFocus = false,
    initialFocusRef,
  } = options;

  useEffect(() => {
    if (!active) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;

    // Move initial focus into the trap.
    const target =
      initialFocusRef?.current ??
      getTabbable(containerRef.current)[0] ??
      containerRef.current;
    target?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        if (stopEscapePropagation) event.stopImmediatePropagation();
        onEscape();
        return;
      }

      if (event.key !== "Tab") return;

      const container = containerRef.current;
      const list = getTabbable(container);
      if (list.length === 0) {
        event.preventDefault();
        container?.focus();
        return;
      }

      const firstEl = list[0];
      const lastEl = list[list.length - 1];
      const activeEl = document.activeElement;

      if (event.shiftKey && (activeEl === firstEl || activeEl === container)) {
        event.preventDefault();
        lastEl.focus();
      } else if (!event.shiftKey && activeEl === lastEl) {
        event.preventDefault();
        firstEl.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown, capture);
    return () => {
      document.removeEventListener("keydown", onKeyDown, capture);
      if (restoreFocus) previouslyFocused?.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, onEscape, capture, stopEscapePropagation, restoreFocus]);
}
