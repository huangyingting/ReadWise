"use client";

import type { WordResult } from "@/components/reader/pronunciationTypes";

type Props = {
  wordResults: WordResult[];
};

export function WordsToWorkOn({ wordResults }: Props) {
  // Filter non-good words, worst first.
  const nonGood = wordResults
    .filter((w) => w.band !== "good" && w.errorType !== "Insertion")
    .sort((a, b) => a.score - b.score);

  return (
    <div className="rw-speak-words-section">
      <h4 className="rw-speak-words-title">Words to work on</h4>
      {nonGood.length === 0 ? (
        <p className="rw-speak-all-good">Every word landed well. 🎯</p>
      ) : (
        <ul className="rw-speak-chips" aria-label="Words to work on">
          {nonGood.map((wr, i) => (
            <li
              key={`${wr.word}-${i}`}
              className={`rw-speak-chip rw-speak-chip--${wr.band}`}
            >
              <span>{wr.word}</span>
              <span aria-hidden>—</span>
              <span>{wr.score}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
