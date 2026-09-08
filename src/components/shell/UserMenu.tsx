"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { signOut } from "next-auth/react";
import { Settings, Shield, LogOut, Keyboard } from "lucide-react";
import { cn, focusRing } from "@/lib/cn";
import { Avatar, Button, IconButton, Popover } from "@/components/ui";
import KeyboardShortcutsModal from "@/components/KeyboardShortcutsModal";
import { useKeyboardShortcut } from "@/lib/use-keyboard-shortcut";
import { prepareOfflineSignOut } from "@/lib/offline/sync-runtime";
import { clientErrorMessage } from "@/lib/client-fetch";
import type { ShellUser } from "./types";

const FIRST_MENU_ITEM_SELECTOR = '[role="menuitem"]';
const SIGN_OUT_ERROR = "Could not clear offline data. Sign out was cancelled.";

const menuItemClass = cn(
  "flex items-center gap-[var(--space-2)] w-full text-left",
  "px-[var(--space-4)] py-[var(--space-2)] text-[length:var(--text-sm)] text-text",
  "transition-colors [transition-duration:var(--duration-fast)]",
  "hover:bg-bg-subtle",
  focusRing,
);

const menuButtonClass =
  "h-auto w-full justify-start rounded-none px-[var(--space-4)] py-[var(--space-2)] text-[length:var(--text-sm)] font-normal text-text hover:bg-bg-subtle";

export default function UserMenu({ user }: { user: ShellUser }) {
  const [open, setOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [signOutBusy, setSignOutBusy] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Global "?" shortcut — open the shortcuts panel when focus is not in a field.
  useKeyboardShortcut(
    "?",
    (e) => {
      e.preventDefault();
      setShortcutsOpen(true);
    },
    { suppressInInput: true, suppressOnModifiers: true },
  );

  const isAdmin = user.role === "Admin";

  // Focus the first menu item when the menu opens.
  useEffect(() => {
    if (open) {
      // Small delay to let Popover render before querying.
      const raf = requestAnimationFrame(() => {
        const first = document.querySelector<HTMLElement>(FIRST_MENU_ITEM_SELECTOR);
        first?.focus();
      });
      return () => cancelAnimationFrame(raf);
    }
  }, [open]);

  function closeMenu() {
    setOpen(false);
  }

  function openShortcuts() {
    setOpen(false);
    setShortcutsOpen(true);
  }

  async function signOutToHome() {
    setSignOutBusy(true);
    setSignOutError(null);
    try {
      await prepareOfflineSignOut();
      setOpen(false);
      await signOut({ callbackUrl: "/" });
    } catch (error) {
      setSignOutError(clientErrorMessage(error, SIGN_OUT_ERROR));
    } finally {
      setSignOutBusy(false);
    }
  }

  return (
    <div className="relative">
      <IconButton
        ref={triggerRef}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="User menu"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "h-8 w-8 overflow-hidden rounded-[var(--radius-full)] p-0",
          open && "[box-shadow:0_0_0_2px_var(--focus-ring)]",
        )}
      >
        <Avatar
          src={user.image}
          name={user.name ?? user.email}
          size={32}
          className="h-8 w-8"
        />
      </IconButton>

      <Popover
        open={open}
        onClose={closeMenu}
        anchorRef={triggerRef}
        label="User menu"
        align="end"
      >
        <div role="menu">
          <div className="px-[var(--space-4)] py-[var(--space-2)]">
            <div className="text-[length:var(--text-sm)] font-semibold text-text truncate">
              {user.name ?? "Reader"}
            </div>
            {user.email ? (
              <div className="text-[length:var(--text-xs)] text-text-subtle truncate">
                {user.email}
              </div>
            ) : null}
          </div>

          <div className="my-[var(--space-1)] border-t border-border" />

          <Link
            href="/settings"
            role="menuitem"
            className={menuItemClass}
            onClick={closeMenu}
          >
            <Settings size={16} aria-hidden />
            Settings
          </Link>

          {isAdmin ? (
            <Link
              href="/admin"
              role="menuitem"
              className={menuItemClass}
              onClick={closeMenu}
            >
              <Shield size={16} aria-hidden />
              Admin Panel
            </Link>
          ) : null}

          <Button
            variant="ghost"
            size="sm"
            role="menuitem"
            onClick={openShortcuts}
            leadingIcon={<Keyboard size={16} aria-hidden />}
            className={menuButtonClass}
          >
            Keyboard shortcuts
          </Button>

          <div className="my-[var(--space-1)] border-t border-border" />

          <Button
            variant="ghost"
            size="sm"
            role="menuitem"
            onClick={signOutToHome}
            disabled={signOutBusy}
            leadingIcon={<LogOut size={16} aria-hidden />}
            className={cn(menuButtonClass, "text-text hover:text-danger-text")}
          >
            {signOutBusy ? "Clearing offline data…" : "Sign out"}
          </Button>
          {signOutError ? (
            <p
              role="alert"
              className="m-0 px-[var(--space-4)] py-[var(--space-2)] text-[length:var(--text-xs)] text-danger-text"
            >
              {signOutError}
            </p>
          ) : null}
        </div>
      </Popover>

      {shortcutsOpen ? (
        <KeyboardShortcutsModal onClose={() => setShortcutsOpen(false)} />
      ) : null}
    </div>
  );
}
