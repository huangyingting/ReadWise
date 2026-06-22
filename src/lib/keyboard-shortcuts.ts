/**
 * Central definition of all keyboard shortcuts displayed in the shortcut
 * reference panel (Issue #95).
 *
 * Each entry is pure data — no runtime behaviour is registered here.
 * Components that register actual handlers (CommandPaletteProvider,
 * FlashcardReview, ReaderToolsPanel, …) remain the source of truth for
 * runtime key bindings; this file is the DISPLAY source of truth.
 */

export type ShortcutKey = {
  /** Human-readable key label(s). Each element becomes one <kbd>. */
  keys: string[];
  /** What the shortcut does. */
  description: string;
};

export type ShortcutGroup = {
  /** Section heading. */
  label: string;
  shortcuts: ShortcutKey[];
};

/** Platform-aware modifier label (⌘ on Mac, Ctrl elsewhere). */
export function cmdKey(): string {
  if (typeof navigator === "undefined") return "Ctrl";
  return /Mac|iPhone|iPod|iPad/.test(navigator.platform ?? "") ? "⌘" : "Ctrl";
}

/** All shortcut groups shown in the reference panel. */
export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    label: "Navigation",
    shortcuts: [
      { keys: ["⌘K"], description: "Open command palette / search" },
      { keys: ["/"], description: "Open command palette (when not in a field)" },
      { keys: ["?"], description: "Open keyboard shortcuts panel" },
      { keys: ["G", "D"], description: "Go to Dashboard" },
      { keys: ["G", "B"], description: "Go to Browse" },
      { keys: ["G", "S"], description: "Go to Study" },
      { keys: ["G", "P"], description: "Go to Progress" },
    ],
  },
  {
    label: "Reader",
    shortcuts: [
      { keys: ["⌘E"], description: "Look up word / open dictionary (with text selected)" },
      { keys: ["←", "→"], description: "Switch tool tabs (when reader tools tab bar is focused)" },
      { keys: ["Esc"], description: "Close open panel / popover" },
    ],
  },
  {
    label: "Flashcard study",
    shortcuts: [
      { keys: ["Space"], description: "Flip card / submit answer" },
      { keys: ["1"], description: "Grade: Again" },
      { keys: ["2"], description: "Grade: Hard" },
      { keys: ["3"], description: "Grade: Good" },
      { keys: ["4"], description: "Grade: Easy" },
      { keys: ["Esc"], description: "End session" },
    ],
  },
  {
    label: "General",
    shortcuts: [
      { keys: ["Tab"], description: "Move focus forward" },
      { keys: ["Shift", "Tab"], description: "Move focus backward" },
      { keys: ["Enter"], description: "Activate focused item" },
    ],
  },
];
