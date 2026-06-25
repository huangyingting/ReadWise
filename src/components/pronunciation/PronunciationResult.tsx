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

export function PronunciationResult({
  result,
  sentenceHistory,
  savedNote,
  isNewBest,
  onRecordAgain,
}: Props) {
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
      {(sentenceHistory.best !== null || isNewBest) && (
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
        {savedNote === "saving" ? (
          "Saving…"
        ) : savedNote === "saved" ? (
          <>
            <Check size={12} aria-hidden />
            {" "}Attempt saved
          </>
        ) : savedNote === "failed" ? (
          "Couldn't save this attempt"
        ) : null}
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
