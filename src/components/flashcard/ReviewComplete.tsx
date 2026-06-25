"use client";

import { CircleCheck } from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { Grade } from "./types";

interface ReviewCompleteProps {
  total: number;
  gradeCounts: Record<Grade, number>;
  dueCount: number;
  onDone: () => void;
  onReviewAgain: () => void;
}

/** Session-complete summary screen. */
export function ReviewComplete({
  total,
  gradeCounts,
  dueCount,
  onDone,
  onReviewAgain,
}: ReviewCompleteProps) {
  return (
    <div className="flex flex-col items-center text-center gap-[var(--space-4)] py-[var(--space-6)]">
      <div
        className="inline-flex items-center justify-center h-14 w-14 rounded-full rw-pop"
        style={{
          background: "color-mix(in srgb, var(--success) 12%, transparent)",
          color: "var(--success-text)",
        }}
      >
        <CircleCheck size={40} aria-hidden />
      </div>

      <div>
        <p className="font-[family-name:var(--font-display)] text-[length:var(--text-lg)] text-text m-0">
          Session complete
        </p>
        <p
          className="text-[length:var(--text-sm)] text-text-muted m-0"
          style={{ marginTop: "var(--space-1)" }}
        >
          Reviewed {total} card{total === 1 ? "" : "s"}.{" "}
          {gradeCounts.again > 0
            ? `${gradeCounts.again} to review again · `
            : ""}
          {(gradeCounts.good ?? 0) + (gradeCounts.easy ?? 0)} known
        </p>
      </div>

      <div className="flex items-center gap-[var(--space-3)]">
        <Button variant="primary" onClick={onDone}>
          Done
        </Button>
        {dueCount > 0 && (
          <Button variant="ghost" onClick={onReviewAgain}>
            Review again
          </Button>
        )}
      </div>
    </div>
  );
}
