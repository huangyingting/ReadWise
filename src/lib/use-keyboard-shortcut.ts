"use client";

/**
 * Keyboard shortcut binding helpers (#515 — REF-078).
 *
 * Provides a stable-ref-based hook for registering a single keyboard shortcut,
 * plus a pure helper for detecting editable targets that is used internally and
 * in tests.
 */

import { useEffect, useRef } from "react";

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Returns true when the event target is an editable field where typing is
 * expected (input, textarea, or contenteditable host). Used to suppress global
 * shortcuts that should not fire while the user is typing.
 *
 * Uses duck typing (tagName + isContentEditable property check) rather than
 * `instanceof HTMLElement` so the function is testable in Node.js without a DOM.
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!target) return false;
  const el = target as unknown as Record<string, unknown>;
  if (typeof el.tagName !== "string") return false;
  const tag = el.tagName as string;
  return tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable === true;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface KeyboardShortcutOptions {
  /**
   * Requires e.metaKey || e.ctrlKey (platform-aware modifier). When true the
   * shortcut fires only when the platform modifier is held.
   */
  requireMeta?: boolean;
  /**
   * Suppress the shortcut when e.metaKey, e.ctrlKey, or e.altKey is held.
   * Useful for letter/punctuation shortcuts like "?" and "/" that must not
   * collide with browser or OS bindings.
   */
  suppressOnModifiers?: boolean;
  /**
   * Suppress firing when the event target is an editable field (input,
   * textarea, contenteditable).
   */
  suppressInInput?: boolean;
  /** Disable the binding without removing the hook call. */
  disabled?: boolean;
  /** Listen on the capture phase instead of the bubble phase. */
  capture?: boolean;
}

/**
 * Binds a keyboard shortcut on `window` and cleans up automatically.
 *
 * The handler is kept in a ref so callers do NOT need to memoize it with
 * `useCallback` — the listener is only re-registered when the option values
 * (key, requireMeta, etc.) change, not when the handler closure changes.
 *
 * @example
 * // ⌘K / Ctrl+K — toggle command palette
 * useKeyboardShortcut("k", (e) => { e.preventDefault(); toggle(); }, { requireMeta: true });
 *
 * // "/" — open command palette when not in a text field
 * useKeyboardShortcut("/", (e) => { e.preventDefault(); open(); }, { suppressInInput: true });
 *
 * // "?" — open shortcuts modal (suppress if modifier is held)
 * useKeyboardShortcut("?", (e) => { e.preventDefault(); openModal(); }, {
 *   suppressInInput: true,
 *   suppressOnModifiers: true,
 * });
 */
export function useKeyboardShortcut(
  key: string,
  handler: (e: KeyboardEvent) => void,
  options: KeyboardShortcutOptions = {},
): void {
  const {
    requireMeta = false,
    suppressOnModifiers = false,
    suppressInInput = false,
    disabled = false,
    capture = false,
  } = options;

  // Keep the latest handler in a ref so the listener is never stale.
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (disabled) return;

    function onKeyDown(e: KeyboardEvent) {
      if (requireMeta) {
        if (!e.metaKey && !e.ctrlKey) return;
      }
      if (suppressOnModifiers && (e.metaKey || e.ctrlKey || e.altKey)) return;
      if (e.key.toLowerCase() !== key.toLowerCase() && e.key !== key) return;
      if (suppressInInput && isEditableTarget(e.target)) return;
      handlerRef.current(e);
    }

    window.addEventListener("keydown", onKeyDown, capture);
    return () => window.removeEventListener("keydown", onKeyDown, capture);
  }, [key, requireMeta, suppressOnModifiers, suppressInInput, disabled, capture]);
}
