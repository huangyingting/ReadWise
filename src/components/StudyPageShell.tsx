"use client";

import { useState } from "react";
import FlashcardReview from "@/components/FlashcardReview";
import StudyList, { type StudyWord } from "@/components/StudyList";

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
      <section style={{ marginTop: "var(--space-9)" }}>
        <h2
          className="font-[family-name:var(--font-display)] font-semibold text-[length:var(--text-2xl)] text-text m-0"
          style={{ marginBottom: "var(--space-4)" }}
        >
          Saved words
        </h2>
        <p
          className="text-text-muted text-[length:var(--text-sm)] m-0"
          style={{ marginBottom: "var(--space-4)" }}
        >
          {words.length} saved {words.length === 1 ? "word" : "words"}
        </p>

        <StudyList words={words} reviewing={reviewing} />
      </section>
    </>
  );
}
