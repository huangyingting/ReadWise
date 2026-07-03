"use client";

import { Layers, FileQuestion, CheckCircle2 } from "lucide-react";
import { Button, Card, CardMeta, CardTitle, EmptyState, Stack } from "@/components/ui";

interface ReviewStartCardProps {
  dueCount: number;
  onStartFlashcard: () => void;
  onStartCloze: () => void;
}

function dueSummary(dueCount: number) {
  if (dueCount === 0) return "You're all caught up.";

  return `${dueCount} card${dueCount === 1 ? "" : "s"} due for review`;
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
          <CardTitle level="h2" className="text-[length:var(--text-2xl)]">
            Flashcard review
          </CardTitle>
          <CardMeta className="mt-[var(--space-1)]">
            {dueSummary(dueCount)}
          </CardMeta>
        </div>
      </div>

      <Stack gap="3" className="mt-[var(--space-5)]">
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
      </Stack>
    </Card>
  );
}
