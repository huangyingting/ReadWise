/**
 * Reading level pills (#1303). Rendered only for articles with adapted levels.
 * Each pill is a link to `?level=…` so switching keeps the article's identity,
 * progress, and history; a teacher lock replaces the pills with a notice.
 */
import Link from "next/link";
import { Lock } from "lucide-react";
import { cn } from "@/lib/cn";
import { readerLevelHref, readingLevelLabel, type ReadingLevelKey } from "@/lib/article-levels/levels";
import type { ReaderLevelOption } from "@/lib/article-levels/variants";
import { Badge, buttonVariants } from "@/components/ui";

type Props = {
  articleId: string;
  level: { key: ReadingLevelKey; locked: boolean; options: ReaderLevelOption[] };
};

export default function ReaderLevelSwitcher({ articleId, level }: Props) {
  if (level.options.length === 0) return null;
  const current = level.options.find((option) => option.levelKey === level.key);

  if (level.locked) {
    return (
      <p className="reader-level-switcher mt-0 mb-[var(--space-4)] flex flex-wrap items-center gap-[var(--space-2)] text-[length:var(--text-sm)] text-text-muted">
        <Lock size={14} aria-hidden="true" />
        Reading level <Badge variant="primary">{current?.label ?? readingLevelLabel(level.key)}</Badge> set by your teacher
      </p>
    );
  }

  return (
    <nav aria-label="Reading level" className="reader-level-switcher mb-[var(--space-3)] flex flex-wrap items-center gap-[var(--space-2)]">
      <span className="text-[length:var(--text-sm)] font-medium text-text-muted">Reading level</span>
      {level.options.map((option) => {
        const selected = option.levelKey === level.key;
        return (
          <Link
            key={option.levelKey}
            href={readerLevelHref(articleId, option.levelKey)}
            aria-current={selected ? "page" : undefined}
            scroll={false}
            className={cn(
              buttonVariants({ variant: selected ? "primary" : "outline", size: "sm" }),
              "rounded-[var(--radius-full)]",
            )}
          >
            {option.label}
            {option.recommended ? <span className="sr-only"> (recommended for you)</span> : null}
            {option.recommended ? (
              <span aria-hidden="true" className="text-[length:var(--type-label)] opacity-80">
                ★
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
