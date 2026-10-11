"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn, focusRing } from "@/lib/cn";

// Footer is hidden on the immersive reader and the utility settings page.
const HIDDEN_PREFIXES = ["/reader", "/settings"];
const FOOTER_CONTAINER_CLASS =
  "flex flex-col items-center gap-[var(--space-2)]";
const FOOTER_TEXT_CLASS =
  "px-[var(--page-gutter)] py-[var(--space-4)] text-[length:var(--type-label)] text-text-subtle";

function isFooterHidden(pathname: string) {
  return HIDDEN_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export default function AppFooter() {
  const pathname = usePathname();
  if (isFooterHidden(pathname)) {
    return null;
  }

  const linkClass = cn(
    "text-text-muted hover:text-primary-text transition-colors [transition-duration:var(--duration-fast)]",
    "rounded-[var(--radius-sm)]",
    focusRing,
  );

  return (
    <footer>
      <div
        className={cn(
          FOOTER_CONTAINER_CLASS,
          FOOTER_TEXT_CLASS,
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
