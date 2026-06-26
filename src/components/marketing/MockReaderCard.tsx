"use client";

import * as React from "react";
import { BookOpen, Volume2, Library, HelpCircle, Check } from "lucide-react";
import { Card, CefrBadge, CategoryBadge, SkeletonText } from "@/components/ui";
import { useMediaQuery } from "@/hooks/useMediaQuery";

const TOOLS = [
  { icon: BookOpen, label: "Read" },
  { icon: Volume2, label: "Narrate" },
  { icon: Library, label: "Vocab" },
  { icon: HelpCircle, label: "Quiz" },
] as const;

/**
 * Pure-CSS stylised reader mock for the hero — zero image dependency. On desktop
 * it carries a subtle 3D tilt that resets flat on hover; under
 * `prefers-reduced-motion` (or below the lg breakpoint) no transform is applied.
 */
export function MockReaderCard() {
  const [hovered, setHovered] = React.useState(false);
  const reduced = useMediaQuery("(prefers-reduced-motion: reduce)");
  const isDesktop = useMediaQuery("(min-width: 1024px)");

  const tilt =
    isDesktop && !reduced && !hovered
      ? "perspective(1200px) rotateY(-6deg) rotateX(2deg)"
      : undefined;

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        transform: tilt,
        transition:
          "transform var(--duration-slow) var(--ease-emphasized)",
      }}
      className="mx-auto w-full max-w-[360px] lg:max-w-[420px]"
    >
      <Card className="rounded-[var(--radius-lg)] shadow-[var(--shadow-xl)]">
        <div className="flex items-center justify-between gap-[var(--space-2)]">
          <span className="text-[length:var(--text-sm)] font-medium text-text-subtle">
            National Geographic
          </span>
          <span className="flex items-center gap-[var(--space-2)]">
            <CefrBadge level="A2" />
            <CategoryBadge>Science</CategoryBadge>
          </span>
        </div>

        <h2 className="mt-[var(--space-4)] font-[family-name:var(--font-display)] text-[length:var(--text-2xl)] font-bold leading-[var(--leading-snug)] text-text">
          The Ocean&apos;s Last Frontier
        </h2>

        <SkeletonText
          lines={3}
          className="mt-[var(--space-4)]"
        />

        <div className="mt-[var(--space-6)] flex items-center gap-[var(--space-3)]">
          <span
            className="block h-1 flex-1 rounded-[var(--radius-full)]"
            style={{
              background:
                "linear-gradient(90deg, var(--teal) 68%, var(--border) 0)",
            }}
            aria-hidden="true"
          />
          <span className="text-[length:var(--text-sm)] font-medium tabular-nums text-text-muted">
            68%
          </span>
          <span className="inline-flex items-center gap-[var(--space-1)] text-[length:var(--text-sm)] text-accent-text">
            <Check size={14} aria-hidden="true" />
            done
          </span>
        </div>

        <div className="mt-[var(--space-6)] grid grid-cols-4 gap-[var(--space-2)]">
          {TOOLS.map(({ icon: Icon, label }) => (
            <span
              key={label}
              className="flex flex-col items-center gap-[var(--space-1)] rounded-[var(--radius-md)] bg-bg-subtle py-[var(--space-2)] text-[length:var(--text-xs)] text-text-subtle"
              aria-hidden="true"
            >
              <Icon size={18} className="text-primary-text" />
              {label}
            </span>
          ))}
        </div>
      </Card>
    </div>
  );
}
