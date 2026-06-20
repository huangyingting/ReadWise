"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn, focusRing } from "@/lib/cn";

// Footer is hidden on the immersive reader and the utility settings page.
const HIDDEN_PREFIXES = ["/reader", "/settings"];

export default function AppFooter() {
  const pathname = usePathname();
  if (HIDDEN_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return null;
  }

  const linkClass = cn(
    "text-text-muted hover:text-primary-text transition-colors [transition-duration:var(--duration-fast)]",
    "rounded-[var(--radius-sm)]",
    focusRing,
  );

  return (
    <footer className="border-t border-border">
      <div
        className={cn(
          "mx-auto flex max-w-[1280px] flex-col items-center gap-[var(--space-2)]",
          "px-[var(--space-6)] py-[var(--space-6)] text-[length:var(--text-sm)] text-text-subtle",
          "sm:flex-row sm:justify-between",
        )}
      >
        <span>© {new Date().getFullYear()} ReadWise</span>
        <nav aria-label="Footer" className="flex items-center gap-[var(--space-4)]">
          <Link href="/privacy" className={linkClass}>
            Privacy
          </Link>
          <Link href="/terms" className={linkClass}>
            Terms
          </Link>
        </nav>
      </div>
    </footer>
  );
}
