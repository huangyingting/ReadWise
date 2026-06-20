"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { Menu, X, Settings, Shield, LogOut } from "lucide-react";
import { cn, focusRing } from "@/lib/cn";
import { PRIMARY_NAV, isActivePath } from "./nav-items";
import ThemeToggle from "./ThemeToggle";
import type { ShellUser } from "./types";

export default function MobileDrawer({ user }: { user: ShellUser }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);

  const isAdmin = user.role === "Admin";

  // Close on route change.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const first = drawerRef.current?.querySelector<HTMLElement>(
      "a, button, [tabindex]:not([tabindex='-1'])",
    );
    first?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = drawerRef.current?.querySelectorAll<HTMLElement>(
        "a, button, [tabindex]:not([tabindex='-1'])",
      );
      if (!focusable || focusable.length === 0) return;
      const list = Array.from(focusable);
      const firstEl = list[0];
      const lastEl = list[list.length - 1];
      if (event.shiftKey && document.activeElement === firstEl) {
        event.preventDefault();
        lastEl.focus();
      } else if (!event.shiftKey && document.activeElement === lastEl) {
        event.preventDefault();
        firstEl.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus();
    };
  }, [open]);

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
      <button
        ref={triggerRef}
        type="button"
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        aria-controls="mobile-drawer"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "md:hidden inline-flex items-center justify-center h-11 w-11 shrink-0",
          "rounded-[var(--radius-md)] text-text-muted hover:bg-bg-subtle hover:text-text",
          focusRing,
        )}
      >
        {open ? <X size={24} aria-hidden /> : <Menu size={24} aria-hidden />}
      </button>

      {open ? (
        <div className="md:hidden">
          {/* Scrim */}
          <div
            aria-hidden
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-[55] bg-[var(--overlay)]"
          />
          {/* Drawer */}
          <div
            id="mobile-drawer"
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-label="Menu"
            className={cn(
              "fixed inset-y-0 left-0 z-[60] flex flex-col",
              "w-[min(280px,80vw)] bg-surface shadow-[var(--shadow-xl)]",
              "motion-safe:transition-transform motion-safe:[transition-duration:var(--duration-slow)] motion-safe:[transition-timing-function:var(--ease-emphasized)]",
            )}
          >
            <div className="flex h-14 items-center justify-between px-[var(--space-6)] border-b border-border">
              <Link
                href="/dashboard"
                onClick={() => setOpen(false)}
                className={cn(
                  "font-[family-name:var(--font-display)] text-[length:var(--text-xl)] font-bold text-text",
                  focusRing,
                )}
              >
                ReadWise
              </Link>
              <button
                type="button"
                aria-label="Close menu"
                onClick={() => setOpen(false)}
                className={cn(
                  "inline-flex items-center justify-center h-11 w-11 shrink-0",
                  "rounded-[var(--radius-md)] text-text-muted hover:bg-bg-subtle hover:text-text",
                  focusRing,
                )}
              >
                <X size={24} aria-hidden />
              </button>
            </div>

            <nav aria-label="Primary" className="py-[var(--space-2)]">
              {PRIMARY_NAV.map(({ href, label, icon: Icon }) => {
                const active = isActivePath(pathname, href);
                return (
                  <Link
                    key={href}
                    href={href}
                    aria-current={active ? "page" : undefined}
                    onClick={() => setOpen(false)}
                    className={linkRow(active)}
                  >
                    <Icon size={20} aria-hidden />
                    {label}
                  </Link>
                );
              })}
            </nav>

            <div className="border-t border-border flex items-center justify-between px-[var(--space-6)] py-[var(--space-3)]">
              <span className="text-[length:var(--text-base)] font-medium text-text-muted">
                Theme
              </span>
              <ThemeToggle />
            </div>

            <div className="border-t border-border py-[var(--space-2)]">
              <Link
                href="/settings"
                onClick={() => setOpen(false)}
                className={linkRow(isActivePath(pathname, "/settings"))}
              >
                <Settings size={20} aria-hidden />
                Settings
              </Link>
              {isAdmin ? (
                <Link
                  href="/admin"
                  onClick={() => setOpen(false)}
                  className={linkRow(isActivePath(pathname, "/admin"))}
                >
                  <Shield size={20} aria-hidden />
                  Admin Panel
                </Link>
              ) : null}
            </div>

            <div className="mt-auto border-t border-border py-[var(--space-2)]">
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
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
          </div>
        </div>
      ) : null}
    </>
  );
}
