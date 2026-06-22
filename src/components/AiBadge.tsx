import { Sparkles } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * AiBadge — small, consistent "AI-generated" indicator chip.
 * Used in the header of every AI tool panel (Words, Quiz, Bilingual, Ask).
 */
export default function AiBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-[var(--space-1)]",
        "rounded-[var(--radius-full)] font-semibold whitespace-nowrap",
        "px-[var(--space-2)] py-[0.125rem] text-[length:var(--text-xs)]",
        "bg-[color-mix(in_srgb,var(--primary)_10%,transparent)]",
        "text-primary-text border border-[color-mix(in_srgb,var(--primary)_24%,transparent)]",
        className,
      )}
      aria-label="AI-generated content"
    >
      <Sparkles size={11} aria-hidden />
      AI-generated
    </span>
  );
}
