import { cn, focusRing } from "@/lib/cn";
import Link from "next/link";

export type WordmarkSize = "header" | "large" | "marketing" | "error";

interface WordmarkProps {
  /** Scale variant for app header, auth hero, and marketing chrome. */
  size?: WordmarkSize;
  className?: string;
}

const WORDMARK_SIZE = {
  header: { textClass: "text-[length:var(--text-xl)]", markSize: 22 },
  large: { textClass: "text-[length:var(--text-2xl)]", markSize: 28 },
  marketing: { textClass: "text-[length:var(--text-xl)]", markSize: 16 },
  error: { textClass: "text-[length:var(--text-xl)]", markSize: 20 },
} as const satisfies Record<
  WordmarkSize,
  { textClass: string; markSize: number }
>;

/**
 * ReadWise brand wordmark — a small diamond SVG mark followed by the name.
 * Used in AppHeader and the sign-in page.
 */
export function Wordmark({ size = "header", className }: WordmarkProps) {
  const { textClass, markSize } = WORDMARK_SIZE[size];

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
        width={markSize}
        height={markSize}
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

interface WordmarkLinkProps {
  /** Link destination (defaults to the app shell dashboard route). */
  href?: string;
  /** Accessible label for the link wrapper. */
  ariaLabel?: string;
  /** Forwarded to the inner Wordmark. */
  size?: WordmarkSize;
  className?: string;
  wordmarkClassName?: string;
}

/** Focusable link wrapper around the canonical ReadWise wordmark. */
export function WordmarkLink({
  href = "/dashboard",
  ariaLabel = "ReadWise — go to dashboard",
  size = "header",
  className,
  wordmarkClassName,
}: WordmarkLinkProps) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex no-underline rounded-[var(--radius-sm)]",
        focusRing,
        className,
      )}
      aria-label={ariaLabel}
    >
      <Wordmark size={size} className={wordmarkClassName} />
    </Link>
  );
}
