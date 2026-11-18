"use client";

/**
 * Screen-only toolbar for the printable packet (#1306): back to the article,
 * choose the packet layout, and open the browser print dialog. Hidden in print.
 */

import Link from "next/link";
import { ArrowLeft, Printer } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui";
import { cn } from "@/lib/cn";
import { EDUCATOR_PRINT_MODES, PRINT_MODE_LABELS, type PrintMode } from "@/lib/reader/print-modes";
import { ORIGINAL_LEVEL, levelQuery, type ReadingLevelKey } from "@/lib/article-levels/levels";

interface PrintToolbarProps {
  articleId: string;
  mode: PrintMode;
  /** Whether the teacher answer-key layout may be offered. */
  canAnswerKey: boolean;
  /** False when the article cannot be printed (rights restriction). */
  printable: boolean;
  /** Reading level being printed (#1303); kept when switching modes. */
  level?: ReadingLevelKey;
}

export default function PrintToolbar({ articleId, mode, canAnswerKey, printable, level = ORIGINAL_LEVEL }: PrintToolbarProps) {
  const modes = (Object.keys(PRINT_MODE_LABELS) as PrintMode[]).filter(
    (option) => !EDUCATOR_PRINT_MODES.includes(option) || canAnswerKey,
  );

  return (
    <div className="print:hidden border-b border-border bg-surface">
      <div className="mx-auto flex max-w-[var(--container-reading)] flex-wrap items-center gap-[var(--space-3)] px-[var(--page-gutter)] py-[var(--space-3)]">
        <Link
          href={`/reader/${encodeURIComponent(articleId)}`}
          className={buttonVariants({ variant: "ghost", size: "sm" })}
        >
          <ArrowLeft size={14} aria-hidden />
          Back to article
        </Link>
        {printable ? (
          <>
            <nav aria-label="Packet layout" className="flex flex-wrap gap-[var(--space-1)]">
              {modes.map((option) => (
                <Link
                  key={option}
                  href={`/reader/${encodeURIComponent(articleId)}/print?mode=${option}${levelQuery(level, "&")}`}
                  aria-current={option === mode ? "page" : undefined}
                  className={cn(buttonVariants({ variant: option === mode ? "secondary" : "ghost", size: "sm" }))}
                >
                  {PRINT_MODE_LABELS[option]}
                </Link>
              ))}
            </nav>
            <Button
              type="button"
              size="sm"
              className="ml-auto"
              leadingIcon={<Printer size={14} aria-hidden />}
              onClick={() => window.print()}
            >
              Print
            </Button>
          </>
        ) : null}
      </div>
    </div>
  );
}
