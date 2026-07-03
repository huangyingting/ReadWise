"use client";

import { useEffect, type RefObject } from "react";

function lockBodyScroll(): string {
  const prevOverflow = document.body.style.overflow;
  document.body.style.overflow = "hidden";
  return prevOverflow;
}

function restoreDialogState(
  prevOverflow: string,
  openerEl: HTMLElement | null,
): void {
  document.body.style.overflow = prevOverflow;
  // Restore focus to the element that opened the palette.
  openerEl?.focus();
}

/**
 * Sets up focus, body-scroll lock, and opener-focus restoration for the
 * command-palette dialog.
 *
 * - Focuses `inputRef` on mount (auto-focus the search field).
 * - Locks `document.body` scroll while mounted (prevents background scroll).
 * - Restores focus to `openerRef` on unmount (keyboard accessibility — the
 *   element that triggered the palette open receives focus back on close).
 */
export function useCommandPaletteDialog(
  inputRef: RefObject<HTMLInputElement | null>,
  openerRef: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    const openerEl = openerRef.current;
    inputRef.current?.focus();
    const prevOverflow = lockBodyScroll();
    return () => {
      restoreDialogState(prevOverflow, openerEl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
