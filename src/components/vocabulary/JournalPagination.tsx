"use client";

import { Button } from "@/components/ui/Button";

interface JournalPaginationProps {
  page: number;
  totalPages: number;
  isPending: boolean;
  onPageChange: (page: number) => void;
}

export function JournalPagination({
  page,
  totalPages,
  isPending,
  onPageChange,
}: JournalPaginationProps) {
  if (totalPages <= 1) return null;

  const isPreviousDisabled = page <= 1 || isPending;
  const isNextDisabled = page >= totalPages || isPending;

  return (
    <nav aria-label="Vocabulary journal pages" className="admin-pagination">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={isPreviousDisabled}
        onClick={() => onPageChange(page - 1)}
      >
        ← Previous
      </Button>
      <span className="text-[length:var(--text-sm)] text-text-muted">
        Page {page} of {totalPages}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={isNextDisabled}
        onClick={() => onPageChange(page + 1)}
      >
        Next →
      </Button>
    </nav>
  );
}
