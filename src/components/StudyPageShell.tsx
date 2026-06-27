"use client";

import { useState } from "react";
import Link from "next/link";
import FlashcardReview from "@/components/FlashcardReview";
import StudyList, { type StudyWord } from "@/components/StudyList";
import VocabularyExportButtons from "@/components/VocabularyExportButtons";
import { buttonVariants, Section, Toolbar } from "@/components/ui";
import { BookOpen } from "lucide-react";

interface StudyPageShellProps {
  words: StudyWord[];
  initialDueCount: number;
}

/**
 * Client coordinator for the study page.
 *
 * Lifts a `reviewing` boolean to coordinate FlashcardReview ↔ StudyList:
 * while a flashcard session is active the saved-words list is visually
 * dimmed and made inert so it doesn't distract or accept input.
 */
export default function StudyPageShell({
  words,
  initialDueCount,
}: StudyPageShellProps) {
  const [reviewing, setReviewing] = useState(false);

  return (
    <>
      {/* Flashcard review — above the saved-words list per Saul §4.8 */}
      <FlashcardReview
        initialDueCount={initialDueCount}
        onSessionStart={() => setReviewing(true)}
        onSessionEnd={() => setReviewing(false)}
      />

      {/* Saved words list — dimmed + inert while a review session is active */}
      <Section
        title="Saved words"
        className="mt-[var(--space-7)]"
      >
        <Toolbar className="mb-[var(--space-4)]">
          <p className="text-text-muted text-[length:var(--text-sm)] m-0">
            {words.length} saved {words.length === 1 ? "word" : "words"}
          </p>
          <div className="flex items-center gap-[var(--space-2)] flex-wrap">
            <Link
              href="/study/words"
              className={buttonVariants({ variant: "ghost", size: "sm" }) + " inline-flex items-center gap-[var(--space-1)]"}
            >
              <BookOpen size={15} aria-hidden />
              Vocabulary journal
            </Link>
            {words.length > 0 && <VocabularyExportButtons />}
          </div>
        </Toolbar>

        <StudyList words={words} reviewing={reviewing} />
      </Section>
    </>
  );
}
