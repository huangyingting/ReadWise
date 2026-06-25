/**
 * Central definition of all keyboard shortcuts (#95, #515 — REF-078).
 *
 * Previously display-only. Now each entry carries optional runtime metadata so
 * the shortcut modal and the runtime registry stay in sync:
 *
 *  - `scope`         — where the shortcut is active.
 *  - `runtimeOwner`  — the component that registers the actual handler (or
 *                      "reference-only" for reference entries with no handler).
 *  - `disabledInInput` — true when the shortcut must not fire in text inputs.
 *
 * Components that register actual handlers (CommandPaletteProvider,
 * FlashcardReview, …) remain the source of truth for runtime key bindings;
 * this file is the DISPLAY + METADATA source of truth.
 */

export type ShortcutScope =
  | "global"
  | "reader"
  | "flashcard"
  | "reference-only";

export type ShortcutKey = {
  /** Human-readable key label(s). Each element becomes one <kbd>. */
  keys: string[];
  /** What the shortcut does. */
  description: string;
  /**
   * Where this shortcut is active.
   * - `global`         — fires anywhere in the app.
   * - `reader`         — fires only inside the article reader.
   * - `flashcard`      — fires only during a flashcard/cloze study session.
   * - `reference-only` — listed for documentation; no runtime handler.
   */
  scope?: ShortcutScope;
  /**
   * The component that owns the runtime handler. Used for documentation and
   * drift detection. Omit for `reference-only` entries.
   */
  runtimeOwner?: string;
  /**
   * True when the shortcut is suppressed while focus is inside a text input,
   * textarea, or contenteditable element.
   */
  disabledInInput?: boolean;
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
      {
        keys: ["⌘K"],
        description: "Open command palette / search",
        scope: "global",
        runtimeOwner: "CommandPaletteProvider",
        disabledInInput: false,
      },
      {
        keys: ["/"],
        description: "Open command palette (when not in a field)",
        scope: "global",
        runtimeOwner: "CommandPaletteProvider",
        disabledInInput: true,
      },
      {
        keys: ["?"],
        description: "Open keyboard shortcuts panel",
        scope: "global",
        runtimeOwner: "UserMenu",
        disabledInInput: true,
      },
      {
        keys: ["G", "D"],
        description: "Go to Dashboard",
        scope: "reference-only",
      },
      {
        keys: ["G", "B"],
        description: "Go to Browse",
        scope: "reference-only",
      },
      {
        keys: ["G", "S"],
        description: "Go to Study",
        scope: "reference-only",
      },
      {
        keys: ["G", "P"],
        description: "Go to Progress",
        scope: "reference-only",
      },
    ],
  },
  {
    label: "Reader",
    shortcuts: [
      {
        keys: ["⌘E"],
        description: "Look up word / open dictionary (with text selected)",
        scope: "reader",
        runtimeOwner: "WordLookup",
        disabledInInput: false,
      },
      {
        keys: ["←", "→"],
        description: "Switch tool tabs (when reader tools tab bar is focused)",
        scope: "reader",
        runtimeOwner: "ReaderTools",
        disabledInInput: false,
      },
      {
        keys: ["Esc"],
        description: "Close open panel / popover",
        scope: "reader",
        runtimeOwner: "ReaderToolsSurface",
        disabledInInput: false,
      },
    ],
  },
  {
    label: "Flashcard study",
    shortcuts: [
      {
        keys: ["Space"],
        description: "Flip card / submit answer",
        scope: "flashcard",
        runtimeOwner: "FlashcardReview",
        disabledInInput: false,
      },
      {
        keys: ["1"],
        description: "Grade: Again",
        scope: "flashcard",
        runtimeOwner: "FlashcardReview",
        disabledInInput: false,
      },
      {
        keys: ["2"],
        description: "Grade: Hard",
        scope: "flashcard",
        runtimeOwner: "FlashcardReview",
        disabledInInput: false,
      },
      {
        keys: ["3"],
        description: "Grade: Good",
        scope: "flashcard",
        runtimeOwner: "FlashcardReview",
        disabledInInput: false,
      },
      {
        keys: ["4"],
        description: "Grade: Easy",
        scope: "flashcard",
        runtimeOwner: "FlashcardReview",
        disabledInInput: false,
      },
      {
        keys: ["Esc"],
        description: "End session",
        scope: "flashcard",
        runtimeOwner: "FlashcardReview",
        disabledInInput: false,
      },
    ],
  },
  {
    label: "General",
    shortcuts: [
      {
        keys: ["Tab"],
        description: "Move focus forward",
        scope: "reference-only",
      },
      {
        keys: ["Shift", "Tab"],
        description: "Move focus backward",
        scope: "reference-only",
      },
      {
        keys: ["Enter"],
        description: "Activate focused item",
        scope: "reference-only",
      },
    ],
  },
];
