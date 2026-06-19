import Link from "next/link";
import { cn } from "@/lib/cn";

/**
 * ReadWise brand wordmark: an inline diamond glyph (no image asset) plus the
 * Space Grotesk logotype. Links home and is reused by the marketing header and
 * footer.
 */
export function Wordmark({ className }: { className?: string }) {
  return (
    <Link
      href="/"
      aria-label="ReadWise home"
      className={cn(
        "inline-flex items-center gap-[var(--space-2)] no-underline",
        className,
      )}
    >
      <svg
        width="16"
        height="16"
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
      <span className="font-[family-name:var(--font-display)] font-bold text-[length:var(--text-xl)] text-text">
        ReadWise
      </span>
    </Link>
  );
}
