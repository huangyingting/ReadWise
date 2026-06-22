/**
 * Shared focus-trap helpers (#210).
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
