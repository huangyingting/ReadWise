import { cn, focusRing } from "@/lib/cn";
import Link from "next/link";

interface WordmarkProps {
  /** Scale variant — "header" (default) uses xl, "large" uses 2xl */
  size?: "header" | "large";
  className?: string;
}

/**
 * ReadWise brand wordmark — a small diamond SVG mark followed by the name.
 * Used in AppHeader and the sign-in page.
 */
export function Wordmark({ size = "header", className }: WordmarkProps) {
  const textClass =
    size === "large"
      ? "text-[length:var(--text-2xl)]"
      : "text-[length:var(--text-xl)]";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-[var(--space-2)]",
        "font-[family-name:var(--font-display)] font-bold text-text",
        textClass,
        className,
      )}
    >
      {/* Diamond mark — same geometry as sign-in page */}
      <svg
        width={size === "large" ? 28 : 22}
        height={size === "large" ? 28 : 22}
        viewBox="0 0 16 16"
        fill="none"
        stroke="var(--primary)"
        strokeWidth="1.6"
        strokeLinejoin="round"
        aria-hidden="true"
        className="shrink-0"
      >
        <path d="M8 1.5 14.5 8 8 14.5 1.5 8 8 1.5Z" />
        <path d="M8 4.5v7" />
      </svg>
      ReadWise
    </span>
  );
}

/** Wordmark as a link to /dashboard (for use inside the app shell). */
export function WordmarkLink({ className }: { className?: string }) {
  return (
    <Link
      href="/dashboard"
      className={cn("rounded-[var(--radius-sm)]", focusRing, className)}
      aria-label="ReadWise — go to dashboard"
    >
      <Wordmark />
    </Link>
  );
}
