"use client";

import { Badge } from "@/components/ui/Badge";

const RING_R = 28;
const RING_C = 2 * Math.PI * RING_R; // ≈ 175.93
const EXCELLENT_SCORE = 85;
const GOOD_SCORE = 70;

type ScoreBadgeVariant = "success" | "warning" | "neutral";
type ScoreFeedback = {
  label: string;
  variant: ScoreBadgeVariant;
};

const DEFAULT_SCORE_FEEDBACK: ScoreFeedback = {
  label: "Keep practicing",
  variant: "neutral",
};

const SCORE_FEEDBACK_BY_THRESHOLD: Array<{
  minScore: number;
  feedback: ScoreFeedback;
}> = [
  {
    minScore: EXCELLENT_SCORE,
    feedback: { label: "Excellent", variant: "success" },
  },
  { minScore: GOOD_SCORE, feedback: { label: "Good", variant: "warning" } },
];

const RING_CIRCLE_PROPS = {
  cx: "36",
  cy: "36",
  r: RING_R,
  fill: "none",
  strokeWidth: "8",
  strokeLinecap: "round" as const,
};

function scoreOffset(score: number): number {
  return RING_C * (1 - score / 100);
}

function scoreFeedback(score: number): ScoreFeedback {
  return (
    SCORE_FEEDBACK_BY_THRESHOLD.find(({ minScore }) => score >= minScore)
      ?.feedback ?? DEFAULT_SCORE_FEEDBACK
  );
}

export function ScoreRing({ score }: { score: number }) {
  const offset = scoreOffset(score);
  const { label, variant } = scoreFeedback(score);

  return (
    <div className="rw-speak-ring-row">
      <div
        role="img"
        aria-label={`Pronunciation score: ${score} out of 100.`}
        className="rw-speak-ring-wrap"
      >
        <svg viewBox="0 0 72 72" className="rw-speak-ring" aria-hidden>
          {/* Track */}
          <circle
            {...RING_CIRCLE_PROPS}
            stroke="var(--reading-border, var(--border))"
          />
          {/* Progress arc — teal (reading-state achievement) */}
          <circle
            {...RING_CIRCLE_PROPS}
            stroke="var(--teal)"
            strokeDasharray={RING_C}
            strokeDashoffset={offset}
          />
        </svg>
        <div className="rw-speak-ring-center" aria-hidden>
          <span className="rw-speak-ring-score">{score}</span>
          <span className="rw-speak-ring-caption">Score</span>
        </div>
      </div>

      {/* Qualitative chip + caption beside ring */}
      <div className="rw-speak-ring-info">
        <p
          className="font-semibold text-[length:var(--text-base)] m-0"
          style={{ color: "var(--reading-text, var(--text))" }}
        >
          Pronunciation
        </p>
        <Badge variant={variant}>{label}</Badge>
      </div>
    </div>
  );
}
