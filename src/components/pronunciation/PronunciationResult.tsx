"use client";

import { Check, RotateCcw, Star } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { ScoreRing } from "@/components/pronunciation/ScoreRing";
import { SubScoreBars } from "@/components/pronunciation/SubScoreBars";
import { WordsToWorkOn } from "@/components/pronunciation/WordsToWorkOn";
import type {
  AssessResult,
  SavedNote,
  SentenceHistory,
} from "@/components/reader/pronunciationTypes";

type Props = {
  result: AssessResult;
  sentenceHistory: SentenceHistory;
  savedNote: SavedNote;
  isNewBest: boolean;
  onRecordAgain: () => void;
};

function SavedAttemptNote({ savedNote }: { savedNote: SavedNote }) {
  if (savedNote === "saving") {
    return "Saving…";
  }

  if (savedNote === "saved") {
    return (
      <>
        <Check size={12} aria-hidden />
        {" "}Attempt saved
      </>
    );
  }

  if (savedNote === "failed") {
    return "Couldn't save this attempt";
  }

  return null;
}

export function PronunciationResult({
  result,
  sentenceHistory,
  savedNote,
  isNewBest,
  onRecordAgain,
}: Props) {
  const showSentenceHistory = sentenceHistory.best !== null || isNewBest;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={`Pronunciation score: ${result.pronScore} out of 100.`}
      className="rw-speak-result rw-fade-up"
    >
      <ScoreRing score={result.pronScore} />
      <SubScoreBars
        accuracy={result.accuracyScore}
        fluency={result.fluencyScore}
        completeness={result.completenessScore}
      />
      <WordsToWorkOn wordResults={result.words} />

      {/* Per-sentence best / last */}
      {showSentenceHistory && (
        <div className={cn("rw-speak-history-line", isNewBest && "rw-speak-new-best")}>
          <span className="rw-speak-best-badge">
            <Star size={12} aria-hidden />
            Best {sentenceHistory.best ?? result.pronScore}
          </span>
          {sentenceHistory.last !== null && (
            <span>· Last {sentenceHistory.last}</span>
          )}
          {isNewBest && (
            <Badge variant="success">New best! 🎉</Badge>
          )}
        </div>
      )}

      {/* Saved note */}
      <p className="rw-speak-saved-note" aria-live="polite">
        <SavedAttemptNote savedNote={savedNote} />
      </p>

      {/* Record again */}
      <Button
        variant="outline"
        size="sm"
        leadingIcon={<RotateCcw size={14} aria-hidden />}
        onClick={onRecordAgain}
      >
        Record again
      </Button>
    </div>
  );
}
