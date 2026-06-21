"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Sparkles, X } from "lucide-react";
import { cn, focusRing } from "@/lib/cn";

const WELCOME_SEEN_KEY = "readwise:welcome-seen";

/**
 * First-run welcome banner on the dashboard.
 * Shown by SSR when the user is detected as new; hidden by the client if
 * localStorage says they've already seen the welcome tour.
 */
export default function DashboardWelcomeBanner() {
  const [visible, setVisible] = useState(true);

  // Hide immediately if the welcome tour was already seen.
  useEffect(() => {
    try {
      if (localStorage.getItem(WELCOME_SEEN_KEY)) {
        setVisible(false);
      }
    } catch {
      // Ignore storage errors.
    }
  }, []);

  function dismiss() {
    setVisible(false);
    try {
      localStorage.setItem(WELCOME_SEEN_KEY, "1");
    } catch {
      // Ignore storage errors.
    }
  }

  if (!visible) return null;

  return (
    <div
      className={cn(
        "mt-[var(--space-5)] p-[var(--space-5)]",
        "rounded-[var(--radius-lg)] border",
        "bg-[color-mix(in_srgb,var(--primary)_6%,var(--surface))] border-[color-mix(in_srgb,var(--primary)_20%,transparent)]",
        "flex items-start gap-[var(--space-4)]",
      )}
      role="note"
      aria-label="Welcome to ReadWise"
    >
      <span
        className="shrink-0 text-[1.5rem] leading-none"
        aria-hidden="true"
      >
        🎉
      </span>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-text m-0 mb-[var(--space-1)]">
          Welcome! Ready for your first article?
        </p>
        <p className="text-text-muted text-[length:var(--text-sm)] m-0 mb-[var(--space-3)]">
          Browse articles matched to your level, use 8 AI learning tools, and build your reading streak.
        </p>
        <div className="flex flex-wrap gap-[var(--space-2)]">
          <Link
            href="/browse"
            onClick={dismiss}
            className={cn(
              "inline-flex items-center gap-[var(--space-1)]",
              "px-[var(--space-3)] py-[var(--space-2)]",
              "bg-primary text-on-primary rounded-[var(--radius-md)]",
              "text-[length:var(--text-sm)] font-semibold no-underline",
              "transition-colors [transition-duration:var(--duration-fast)]",
              "hover:bg-primary-hover",
              focusRing,
            )}
          >
            <Sparkles size={14} aria-hidden />
            Start your first article →
          </Link>
        </div>
      </div>
      <button
        type="button"
        aria-label="Dismiss welcome banner"
        onClick={dismiss}
        className={cn(
          "shrink-0 inline-flex items-center justify-center",
          "w-8 h-8 rounded-[var(--radius-md)]",
          "text-text-muted hover:bg-bg-subtle hover:text-text",
          focusRing,
        )}
      >
        <X size={16} aria-hidden />
      </button>
    </div>
  );
}
