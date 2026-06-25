/**
 * Pure keyboard-navigation index arithmetic for the command palette.
 *
 * No React, no DOM — fully testable in Node.js.
 */

export type NavKey = "ArrowDown" | "ArrowUp" | "Home" | "End";

/**
 * Returns the next active index given the current index, list length, and
 * the pressed navigation key.  ArrowDown/Up wrap around; Home/End clamp.
 *
 * Returns 0 when `len` is 0 (empty list — no-op sentinel).
 */
export function nextNavIndex(current: number, len: number, key: NavKey): number {
  if (len === 0) return 0;
  switch (key) {
    case "ArrowDown":
      return current >= len - 1 ? 0 : current + 1;
    case "ArrowUp":
      return current <= 0 ? len - 1 : current - 1;
    case "Home":
      return 0;
    case "End":
      return len - 1;
  }
}
