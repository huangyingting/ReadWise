"use client";

import { buttonVariants } from "@/components/ui/Button";

/**
 * Two download links (CSV and Anki TSV) for the user's saved vocabulary.
 * Plain <a href> links trigger a native browser download — no JS fetch needed.
 */
export default function VocabularyExportButtons() {
  return (
    <div className="flex items-center gap-[var(--space-2)] flex-wrap">
      <span className="text-text-muted text-[length:var(--text-sm)]">Export:</span>
      <a
        href="/api/vocabulary/export?format=csv"
        download
        className={buttonVariants({ variant: "outline", size: "sm" })}
      >
        CSV
      </a>
      <a
        href="/api/vocabulary/export?format=anki"
        download
        className={buttonVariants({ variant: "outline", size: "sm" })}
      >
        Anki
      </a>
    </div>
  );
}
