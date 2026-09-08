"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { Settings, Shield, Keyboard, LogOut } from "lucide-react";
import { cn, focusRing } from "@/lib/cn";
import { Badge, Button, Sheet } from "@/components/ui";
import { SECONDARY_NAV, isActivePath, filterNavForUser } from "./nav-items";
import ThemeToggle from "./ThemeToggle";
import KeyboardShortcutsModal from "@/components/KeyboardShortcutsModal";
import { prepareOfflineSignOut } from "@/lib/offline/sync-runtime";
import { clientErrorMessage } from "@/lib/client-fetch";
import type { ShellUser } from "./types";

interface MoreSheetProps {
  user: ShellUser;
  open: boolean;
  onClose: () => void;
}

const ACTION_ROW_CLASS =
  "h-auto w-full justify-start rounded-none border-l-[3px] border-transparent px-[var(--space-6)] py-[var(--space-3)] text-[length:var(--text-base)] font-medium text-text-muted hover:bg-bg-subtle hover:text-text";
const SIGN_OUT_ERROR = "Could not clear offline data. Sign out was cancelled.";

function getLinkRowClass(active: boolean): string {
  return cn(
    "flex items-center gap-[var(--space-3)] w-full",
    "px-[var(--space-6)] py-[var(--space-3)] text-[length:var(--text-base)]",
    "transition-colors [transition-duration:var(--duration-fast)]",
    active
      ? "font-semibold text-primary-text bg-bg-subtle border-l-[3px] border-[var(--teal)]"
      : "font-medium text-text-muted hover:text-text hover:bg-bg-subtle border-l-[3px] border-transparent",
    focusRing,
  );
}

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
}: MoreSheetProps) {
  const pathname = usePathname();
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [signOutBusy, setSignOutBusy] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const isAdmin = user.role === "Admin";

  async function handleSignOut() {
    setSignOutBusy(true);
    setSignOutError(null);
    try {
      await prepareOfflineSignOut();
      onClose();
      await signOut({ callbackUrl: "/" });
    } catch (error) {
      setSignOutError(clientErrorMessage(error, SIGN_OUT_ERROR));
    } finally {
      setSignOutBusy(false);
    }
  }

  return (
    <>
      <Sheet open={open} onClose={onClose} side="bottom" label="More">
        <div className="flex h-12 items-center px-[var(--space-6)] border-b border-border">
          <h2 className="text-[length:var(--text-base)] font-semibold text-text">
            More
          </h2>
        </div>

        <nav aria-label="Secondary" className="py-[var(--space-2)]">
          {filterNavForUser(SECONDARY_NAV, user.showTodayNav ?? false).map(({ href, label, icon: Icon }) => {
            const active = isActivePath(pathname, href);
            const showBadge = href === "/assignments" && (user.pendingAssignmentCount ?? 0) > 0;
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                onClick={onClose}
                className={getLinkRowClass(active)}
              >
                <Icon size={20} aria-hidden />
                {label}
                {showBadge ? (
                  <Badge
                    variant="primary"
                    aria-label={`${user.pendingAssignmentCount} pending assignments`}
                  >
                    {user.pendingAssignmentCount}
                  </Badge>
                ) : null}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-border py-[var(--space-2)]">
          <Link
            href="/settings"
            onClick={onClose}
            className={getLinkRowClass(isActivePath(pathname, "/settings"))}
          >
            <Settings size={20} aria-hidden />
            Settings
          </Link>
          {isAdmin ? (
            <Link
              href="/admin"
              onClick={onClose}
              className={getLinkRowClass(isActivePath(pathname, "/admin"))}
            >
              <Shield size={20} aria-hidden />
              Admin Panel
            </Link>
          ) : null}
          <Button
            variant="ghost"
            size="lg"
            onClick={() => setShortcutsOpen(true)}
            leadingIcon={<Keyboard size={20} aria-hidden />}
            className={ACTION_ROW_CLASS}
          >
            Keyboard shortcuts
          </Button>
        </div>

        <div className="border-t border-border flex items-center justify-between px-[var(--space-6)] py-[var(--space-3)]">
          <span className="text-[length:var(--text-base)] font-medium text-text-muted">
            Theme
          </span>
          <ThemeToggle />
        </div>

        <div className="border-t border-border py-[var(--space-2)]">
          <Button
            variant="ghost"
            size="lg"
            onClick={handleSignOut}
            disabled={signOutBusy}
            leadingIcon={<LogOut size={20} aria-hidden />}
            className={cn(ACTION_ROW_CLASS, "text-danger-text hover:text-danger-text")}
          >
            {signOutBusy ? "Clearing offline data…" : "Sign out"}
          </Button>
          {signOutError ? (
            <p
              role="alert"
              className="m-0 px-[var(--space-6)] py-[var(--space-2)] text-[length:var(--text-sm)] text-danger-text"
            >
              {signOutError}
            </p>
          ) : null}
        </div>
      </Sheet>

      {shortcutsOpen ? (
        <KeyboardShortcutsModal onClose={() => setShortcutsOpen(false)} />
      ) : null}
    </>
  );
}
