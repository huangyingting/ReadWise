"use client";

import type { WordResult } from "@/components/reader/pronunciationTypes";
import { WordDisplay } from "@/components/pronunciation/WordDisplay";
import { PronunciationLegend } from "@/components/pronunciation/PronunciationLegend";

type Props = {
  sentence: string;
  /** When provided, renders word-level band highlighting and the legend. */
  wordResults?: WordResult[] | null;
};

/**
 * Renders the practice sentence.
 * In result phase, pass `wordResults` to show per-word pronunciation bands
 * and the scoring legend.
 */
export function SentenceCard({ sentence, wordResults }: Props) {
  if (wordResults != null) {
    return (
      <>
        <WordDisplay sentence={sentence} wordResults={wordResults} />
        <PronunciationLegend />
      </>
    );
  }
  return (
    <p className="rw-speak-sentence-card" lang="en">
      {sentence}
    </p>
  );
}
