"use client";

import { Info } from "lucide-react";

type Props = {
  accuracy: number;
  fluency: number;
  completeness: number;
};

export function SubScoreBars({ accuracy, fluency, completeness }: Props) {
  const bars = [
    { label: "Accuracy", score: accuracy },
    { label: "Fluency", score: fluency },
    { label: "Completeness", score: completeness },
  ];

  return (
    <div className="rw-speak-subbar-list">
      {bars.map(({ label, score }) => (
        <div key={label} className="rw-speak-subbar-row">
          <span className="rw-speak-subbar-label">{label}</span>
          <div
            role="meter"
            aria-label={`${label}: ${score} out of 100`}
            aria-valuenow={score}
            aria-valuemin={0}
            aria-valuemax={100}
            className="rw-speak-subbar-track"
          >
            <div
              className="rw-speak-subbar-fill"
              style={{ width: `${score}%` }}
            />
          </div>
          <span className="rw-speak-subbar-value" aria-hidden>
            {score}
          </span>
        </div>
      ))}
      <details className="rw-speak-score-legend">
        <summary>
          <Info size={11} aria-hidden />
          What do these mean?
        </summary>
        <div className="rw-speak-score-legend-body">
          <p className="m-0">
            <strong>Accuracy</strong> — how closely phonemes match native pronunciation.
          </p>
          <p className="m-0">
            <strong>Fluency</strong> — how naturally you paced and connected words.
          </p>
          <p className="m-0">
            <strong>Completeness</strong> — the fraction of reference words you spoke.
          </p>
        </div>
      </details>
    </div>
  );
}
