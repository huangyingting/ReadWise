"use client";

import type { WordResult } from "@/components/reader/pronunciationTypes";

type Props = {
  wordResults: WordResult[];
};

function needsWork({ band, errorType }: WordResult) {
  return band !== "good" && errorType !== "Insertion";
}

function compareWordScore(a: WordResult, b: WordResult) {
  return a.score - b.score;
}

export function WordsToWorkOn({ wordResults }: Props) {
  // Filter non-good words, worst first.
  const nonGood = wordResults
    .filter(needsWork)
    .sort(compareWordScore);

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
