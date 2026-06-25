"use client";

import { Layers, FileQuestion, CheckCircle2 } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import EmptyState from "@/components/EmptyState";

interface ReviewStartCardProps {
  dueCount: number;
  onStartFlashcard: () => void;
  onStartCloze: () => void;
}

/** Idle state card: shows due count and start buttons (or empty-state). */
export function ReviewStartCard({
  dueCount,
  onStartFlashcard,
  onStartCloze,
}: ReviewStartCardProps) {
  return (
    <Card>
      <div className="flex items-start justify-between gap-[var(--space-4)]">
        <div>
          <h2 className="font-[family-name:var(--font-display)] font-semibold text-[length:var(--text-2xl)] text-text m-0">
            Flashcard review
          </h2>
          <p
            className="text-[length:var(--text-sm)] text-text-muted m-0"
            style={{ marginTop: "var(--space-1)" }}
          >
            {dueCount === 0
              ? "You're all caught up."
              : `${dueCount} card${dueCount === 1 ? "" : "s"} due for review`}
          </p>
        </div>
      </div>

      <div style={{ marginTop: "var(--space-5)" }}>
        {dueCount === 0 ? (
          <EmptyState
            icon={CheckCircle2}
            title="All caught up"
            description="No cards are due for review right now. Save more words while reading, or check back later."
            action={{ label: "Browse articles", href: "/browse" }}
          />
        ) : (
          <div className="flex flex-wrap items-center gap-[var(--space-3)]">
            <Button
              variant="primary"
              leadingIcon={<Layers size={16} aria-hidden />}
              onClick={onStartFlashcard}
            >
              Review {dueCount} due
            </Button>
            <Button
              variant="outline"
              leadingIcon={<FileQuestion size={16} aria-hidden />}
              onClick={onStartCloze}
            >
              Cloze review
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}
