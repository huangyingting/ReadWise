import * as React from "react";
import { cn } from "@/lib/cn";

const SKELETON_BASE_CLASS = "bg-bg-subtle";
const SKELETON_SHIMMER_CLASS =
  "bg-[linear-gradient(90deg,var(--bg-subtle),var(--border),var(--bg-subtle))] bg-[length:200%_100%]";
const SKELETON_MOTION_CLASS =
  "animate-shimmer motion-reduce:animate-none motion-reduce:bg-none";

export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Match the radius of the element being stood in for. */
  shape?: "text" | "block";
}

/**
 * Shimmering placeholder. Sweeps a bg-subtle → border → bg-subtle gradient and
 * falls back to a static block under prefers-reduced-motion.
 */
export function Skeleton({ shape = "block", className, ...props }: SkeletonProps) {
  return (
    <div
      aria-hidden
      className={cn(
        SKELETON_BASE_CLASS,
        shape === "text"
          ? "rounded-[var(--radius-sm)] h-[1em]"
          : "rounded-[var(--radius-lg)]",
        SKELETON_SHIMMER_CLASS,
        SKELETON_MOTION_CLASS,
        className,
      )}
      {...props}
    />
  );
}

export interface SkeletonTextProps
  extends React.HTMLAttributes<HTMLDivElement> {
  /** Number of lines; the last line is rendered at 60% width. */
  lines?: number;
}

export function SkeletonText({
  lines = 3,
  className,
  ...props
}: SkeletonTextProps) {
  const lastLineIndex = lines - 1;

  return (
    <div
      className={cn("flex flex-col gap-[var(--space-2)]", className)}
      {...props}
    >
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          shape="text"
          className={i === lastLineIndex ? "w-3/5" : "w-full"}
        />
      ))}
    </div>
  );
}
