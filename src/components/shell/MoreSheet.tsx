"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { Settings, Shield, Keyboard, LogOut } from "lucide-react";
import { cn, focusRing } from "@/lib/cn";
import { Sheet } from "@/components/ui/Sheet";
import { SECONDARY_NAV, isActivePath } from "./nav-items";
import ThemeToggle from "./ThemeToggle";
import KeyboardShortcutsModal from "@/components/KeyboardShortcutsModal";
import type { ShellUser } from "./types";

/**
 * Mobile "More" sheet — the overflow of the BottomTabBar. A bottom-anchored
 * `Sheet` (focus-trapped, Esc/scrim close, returns focus) listing the
 * `SECONDARY_NAV` destinations followed by utility actions: Settings, Admin
 * (admins only), a theme toggle row, the keyboard-shortcuts reference, and sign
 * out. Mirrors the actions the retired MobileDrawer exposed.
 */
export default function MoreSheet({
  user,
  open,
  onClose,
}: {
  user: ShellUser;
  open: boolean;
  onClose: () => void;
}) {
  const pathname = usePathname();
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const isAdmin = user.role === "Admin";

  const linkRow = (active: boolean) =>
    cn(
      "flex items-center gap-[var(--space-3)] w-full",
      "px-[var(--space-6)] py-[var(--space-3)] text-[length:var(--text-base)]",
      "transition-colors [transition-duration:var(--duration-fast)]",
      active
        ? "font-semibold text-primary-text bg-bg-subtle border-l-[3px] border-[var(--teal)]"
        : "font-medium text-text-muted hover:text-text hover:bg-bg-subtle border-l-[3px] border-transparent",
      focusRing,
    );

  return (
    <>
      <Sheet open={open} onClose={onClose} side="bottom" label="More">
        <div className="flex h-12 items-center px-[var(--space-6)] border-b border-border">
          <h2 className="text-[length:var(--text-base)] font-semibold text-text">
            More
          </h2>
        </div>

        <nav aria-label="Secondary" className="py-[var(--space-2)]">
          {SECONDARY_NAV.map(({ href, label, icon: Icon }) => {
            const active = isActivePath(pathname, href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                onClick={onClose}
                className={linkRow(active)}
              >
                <Icon size={20} aria-hidden />
                {label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-border py-[var(--space-2)]">
          <Link
            href="/settings"
            onClick={onClose}
            className={linkRow(isActivePath(pathname, "/settings"))}
          >
            <Settings size={20} aria-hidden />
            Settings
          </Link>
          {isAdmin ? (
            <Link
              href="/admin"
              onClick={onClose}
              className={linkRow(isActivePath(pathname, "/admin"))}
            >
              <Shield size={20} aria-hidden />
              Admin Panel
            </Link>
          ) : null}
          <button
            type="button"
            onClick={() => setShortcutsOpen(true)}
            className={linkRow(false)}
          >
            <Keyboard size={20} aria-hidden />
            Keyboard shortcuts
          </button>
        </div>

        <div className="border-t border-border flex items-center justify-between px-[var(--space-6)] py-[var(--space-3)]">
          <span className="text-[length:var(--text-base)] font-medium text-text-muted">
            Theme
          </span>
          <ThemeToggle />
        </div>

        <div className="border-t border-border py-[var(--space-2)]">
          <button
            type="button"
            onClick={() => {
              onClose();
              void signOut({ callbackUrl: "/" });
            }}
            className={cn(
              "flex items-center gap-[var(--space-3)] w-full",
              "px-[var(--space-6)] py-[var(--space-3)] text-[length:var(--text-base)] font-medium",
              "text-danger-text hover:bg-bg-subtle border-l-[3px] border-transparent",
              focusRing,
            )}
          >
            <LogOut size={20} aria-hidden />
            Sign out
          </button>
        </div>
      </Sheet>

      {shortcutsOpen ? (
        <KeyboardShortcutsModal onClose={() => setShortcutsOpen(false)} />
      ) : null}
    </>
  );
}
