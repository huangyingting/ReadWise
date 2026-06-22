"use client";

import { buttonVariants } from "@/components/ui/Button";

/**
 * Two download links (CSV and Anki TSV) for the user's saved vocabulary.
 * Plain <a href> links trigger a native browser download — no JS fetch needed.
 */
export default function VocabularyExportButtons() {
  return (
    <div className="flex flex-col gap-[var(--space-2)]">
      <div className="flex items-center gap-[var(--space-2)] flex-wrap">
        <span className="text-text-muted text-[length:var(--text-sm)]">Export:</span>
        <a
          href="/api/vocabulary/export?format=csv"
          download
          className={buttonVariants({ variant: "outline", size: "sm" })}
          title="Download a CSV spreadsheet — columns: word, definition, example sentence, article, date saved, next review date."
        >
          CSV
        </a>
        <a
          href="/api/vocabulary/export?format=anki"
          download
          className={buttonVariants({ variant: "outline", size: "sm" })}
          title="Download a tab-separated file you can import into Anki (a free flashcard app) — fields: word, definition, example sentence."
        >
          Anki deck
        </a>
      </div>
      <p className="text-text-muted text-[length:var(--text-xs)] m-0">
        CSV includes all columns (word, definition, example, article, date saved, next review date).
        Anki deck is a tab-separated file ready to import into the free{" "}
        <a href="https://apps.ankiweb.net" target="_blank" rel="noopener noreferrer nofollow" className="underline hover:text-text">
          Anki
        </a>{" "}
        flashcard app (word, definition, example).
      </p>
    </div>
  );
}
