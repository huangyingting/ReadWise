"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import CommandPalette from "./CommandPalette";
import type { ShellUser } from "@/components/shell/types";

// ---- Context ----------------------------------------------------------

interface CommandPaletteCtx {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
}

const CommandPaletteContext = createContext<CommandPaletteCtx>({
  isOpen: false,
  open: () => {},
  close: () => {},
  toggle: () => {},
});

export function useCommandPalette(): CommandPaletteCtx {
  return useContext(CommandPaletteContext);
}

// ---- Provider ---------------------------------------------------------

interface CommandPaletteProviderProps {
  user: ShellUser | null;
  children: ReactNode;
}

/**
 * Mounts once in the authed app shell. Owns the open/close state and the
 * global ⌘K / Ctrl+K / "/" keyboard listener. Pass the session-derived
 * `user` (role + display data) from the server shell — never reads auth
 * client-side.
 */
export default function CommandPaletteProvider({
  user,
  children,
}: CommandPaletteProviderProps) {
  const [isOpen, setIsOpen] = useState(false);
  /** The element that was focused before the palette opened, to restore on close. */
  const openerRef = useRef<HTMLElement | null>(null);

  const open = useCallback(() => {
    openerRef.current = document.activeElement as HTMLElement | null;
    setIsOpen(true);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
    // Focus restoration happens inside CommandPalette's cleanup useEffect.
  }, []);

  const toggle = useCallback(() => {
    // We read from the DOM to avoid stale-closure; setIsOpen updater also works.
    setIsOpen((prev) => {
      if (prev) return false;
      openerRef.current = document.activeElement as HTMLElement | null;
      return true;
    });
  }, []);

  // ---- Global keyboard listener ----------------------------------------
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // ⌘K (macOS) / Ctrl+K (win/linux) — toggle
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        toggle();
        return;
      }

      // "/" — open only when focus is not in an editable field
      if (e.key === "/" && !isOpen) {
        const target = e.target as Element | null;
        const inEditable =
          target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement ||
          (target instanceof HTMLElement && target.isContentEditable);
        if (!inEditable) {
          e.preventDefault();
          open();
        }
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, toggle, open]);

  const ctx: CommandPaletteCtx = { isOpen, open, close, toggle };

  return (
    <CommandPaletteContext.Provider value={ctx}>
      {children}
      {isOpen && (
        <CommandPalette user={user} onClose={close} openerRef={openerRef} />
      )}
    </CommandPaletteContext.Provider>
  );
}
