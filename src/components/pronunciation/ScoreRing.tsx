"use client";

import { Badge } from "@/components/ui/Badge";

const RING_R = 28;
const RING_C = 2 * Math.PI * RING_R; // ≈ 175.93

function scoreLabel(score: number): string {
  if (score >= 85) return "Excellent";
  if (score >= 70) return "Good";
  return "Keep practicing";
}

function scoreBadgeVariant(score: number): "success" | "warning" | "neutral" {
  if (score >= 85) return "success";
  if (score >= 70) return "warning";
  return "neutral";
}

export function ScoreRing({ score }: { score: number }) {
  const offset = RING_C * (1 - score / 100);
  const label = scoreLabel(score);
  const variant = scoreBadgeVariant(score);

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
            cx="36"
            cy="36"
            r={RING_R}
            fill="none"
            stroke="var(--reading-border, var(--border))"
            strokeWidth="8"
            strokeLinecap="round"
          />
          {/* Progress arc — teal (reading-state achievement) */}
          <circle
            cx="36"
            cy="36"
            r={RING_R}
            fill="none"
            stroke="var(--teal)"
            strokeWidth="8"
            strokeLinecap="round"
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
