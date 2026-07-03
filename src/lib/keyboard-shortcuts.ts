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

const MAC_PLATFORM_RE = /Mac|iPhone|iPod|iPad/;

const RUNTIME_OWNERS = {
  commandPalette: "CommandPaletteProvider",
  userMenu: "UserMenu",
  wordLookup: "WordLookup",
  readerTools: "ReaderTools",
  readerToolsSurface: "ReaderToolsSurface",
  flashcardReview: "FlashcardReview",
} as const;

function referenceShortcut(keys: string[], description: string): ShortcutKey {
  return { keys, description, scope: "reference-only" };
}

/** Platform-aware modifier label (⌘ on Mac, Ctrl elsewhere). */
export function cmdKey(): string {
  if (typeof navigator === "undefined") return "Ctrl";
  return MAC_PLATFORM_RE.test(navigator.platform ?? "") ? "⌘" : "Ctrl";
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
        runtimeOwner: RUNTIME_OWNERS.commandPalette,
        disabledInInput: false,
      },
      {
        keys: ["/"],
        description: "Open command palette (when not in a field)",
        scope: "global",
        runtimeOwner: RUNTIME_OWNERS.commandPalette,
        disabledInInput: true,
      },
      {
        keys: ["?"],
        description: "Open keyboard shortcuts panel",
        scope: "global",
        runtimeOwner: RUNTIME_OWNERS.userMenu,
        disabledInInput: true,
      },
      referenceShortcut(["G", "D"], "Go to Dashboard"),
      referenceShortcut(["G", "B"], "Go to Browse"),
      referenceShortcut(["G", "S"], "Go to Study"),
      referenceShortcut(["G", "P"], "Go to Progress"),
    ],
  },
  {
    label: "Reader",
    shortcuts: [
      {
        keys: ["⌘E"],
        description: "Look up word / open dictionary (with text selected)",
        scope: "reader",
        runtimeOwner: RUNTIME_OWNERS.wordLookup,
        disabledInInput: false,
      },
      {
        keys: ["←", "→"],
        description: "Switch tool tabs (when reader tools tab bar is focused)",
        scope: "reader",
        runtimeOwner: RUNTIME_OWNERS.readerTools,
        disabledInInput: false,
      },
      {
        keys: ["Esc"],
        description: "Close open panel / popover",
        scope: "reader",
        runtimeOwner: RUNTIME_OWNERS.readerToolsSurface,
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
        runtimeOwner: RUNTIME_OWNERS.flashcardReview,
        disabledInInput: false,
      },
      {
        keys: ["1"],
        description: "Grade: Again",
        scope: "flashcard",
        runtimeOwner: RUNTIME_OWNERS.flashcardReview,
        disabledInInput: false,
      },
      {
        keys: ["2"],
        description: "Grade: Hard",
        scope: "flashcard",
        runtimeOwner: RUNTIME_OWNERS.flashcardReview,
        disabledInInput: false,
      },
      {
        keys: ["3"],
        description: "Grade: Good",
        scope: "flashcard",
        runtimeOwner: RUNTIME_OWNERS.flashcardReview,
        disabledInInput: false,
      },
      {
        keys: ["4"],
        description: "Grade: Easy",
        scope: "flashcard",
        runtimeOwner: RUNTIME_OWNERS.flashcardReview,
        disabledInInput: false,
      },
      {
        keys: ["Esc"],
        description: "End session",
        scope: "flashcard",
        runtimeOwner: RUNTIME_OWNERS.flashcardReview,
        disabledInInput: false,
      },
    ],
  },
  {
    label: "General",
    shortcuts: [
      referenceShortcut(["Tab"], "Move focus forward"),
      referenceShortcut(["Shift", "Tab"], "Move focus backward"),
      referenceShortcut(["Enter"], "Activate focused item"),
    ],
  },
];
