import * as React from "react";
import { cn } from "@/lib/cn";

const SIZE_MAP = { sm: 16, md: 20, lg: 24 } as const;

export interface SpinnerProps extends React.SVGProps<SVGSVGElement> {
  /** Pixel size, or a named size (sm 16 / md 20 / lg 24). */
  size?: keyof typeof SIZE_MAP | number;
  /** Accessible label; defaults to "Loading". */
  label?: string;
}

/**
 * Indeterminate spinner. Inherits `currentColor`, spins at 0.7s, and degrades
 * to a static ring under prefers-reduced-motion.
 */
export function Spinner({
  size = "md",
  label = "Loading",
  className,
  ...props
}: SpinnerProps) {
  const px = typeof size === "number" ? size : SIZE_MAP[size];
  return (
    <svg
      role="status"
      aria-label={label}
      width={px}
      height={px}
      viewBox="0 0 24 24"
      fill="none"
      className={cn(
        "animate-spin [animation-duration:0.7s] motion-reduce:animate-none",
        className,
      )}
      {...props}
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        stroke="currentColor"
        strokeOpacity="0.2"
        strokeWidth="3"
      />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}
