"use client";

import { Check } from "lucide-react";
import { CATEGORIES } from "@/lib/categories";
import { cn } from "@/lib/cn";

interface TopicSelectorProps {
  /** Currently selected topic slugs. */
  topics: string[];
  /** Called with the slug of the chip the user toggled. */
  onToggle: (slug: string) => void;
}

/**
 * Chip group for selecting article topic preferences.
 * Used in both the onboarding flow and the profile settings form.
 */
export function TopicSelector({ topics, onToggle }: TopicSelectorProps) {
  return (
    <div
      role="group"
      aria-label="Topics you enjoy"
      className="flex flex-wrap gap-[var(--space-2)]"
    >
      {CATEGORIES.map((cat) => {
        const selected = topics.includes(cat.slug);
        return (
          <button
            key={cat.slug}
            type="button"
            aria-pressed={selected}
            onClick={() => onToggle(cat.slug)}
            className={cn(
              "inline-flex items-center gap-[var(--space-1)]",
              "min-h-[40px] px-[var(--space-4)]",
              "text-[length:var(--text-sm)] rounded-[var(--radius-full)]",
              "border transition-[background-color,border-color,color]",
              "[transition-duration:var(--duration-fast)]",
              "outline-none focus-visible:[box-shadow:0_0_0_2px_var(--ring-offset),0_0_0_4px_var(--focus-ring)]",
              selected
                ? "bg-[color-mix(in_srgb,var(--primary)_14%,transparent)] text-primary-text border-primary"
                : "bg-bg-subtle text-text-muted border-border hover:border-border-strong",
            )}
          >
            {selected && (
              <Check size={14} aria-hidden className="rw-pop shrink-0" />
            )}
            {cat.label}
          </button>
        );
      })}
    </div>
  );
}
