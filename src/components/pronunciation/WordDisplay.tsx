"use client";

import type { CSSProperties, ReactNode } from "react";
import type { WordBand, WordResult } from "@/components/reader/pronunciationTypes";

const SR_ONLY_STYLE: CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  overflow: "hidden",
  clip: "rect(0,0,0,0)",
  whiteSpace: "nowrap",
};

/** Human-readable band name for sr-only labels. */
function bandSrLabel(band: WordBand): string {
  switch (band) {
    case "good":    return "well pronounced";
    case "fair":    return "close, needs work";
    case "poor":    return "mispronounced";
    case "omitted": return "skipped word";
  }
}

type Props = {
  sentence: string;
  wordResults: WordResult[];
};

function renderWordToken(wr: WordResult, rawWord: string, key: string) {
  if (wr.band === "good") {
    return (
      <span
        key={key}
        className="rw-speak-word rw-speak-word--good"
      >
        {rawWord}
      </span>
    );
  }

  const tooltip = `${rawWord} — ${wr.score}, ${bandSrLabel(wr.band)}`;
  return (
    <span
      key={key}
      className={`rw-speak-word rw-speak-word--${wr.band}`}
      data-tooltip={tooltip}
    >
      {rawWord}
      {/* sr-only label for screen readers */}
      <span className="rw-sr-live" style={SR_ONLY_STYLE}>
        {` (${bandSrLabel(wr.band)})`}
      </span>
    </span>
  );
}

/**
 * Renders the reference sentence with word-level pronunciation band styling.
 * Words that were not scored (empty wordResults) fall back to plain text.
 */
export function WordDisplay({ sentence, wordResults }: Props) {
  const tokens: ReactNode[] = [];

  if (wordResults.length === 0) {
    return (
      <p className="rw-speak-sentence-card" lang="en">
        {sentence}
      </p>
    );
  }

  // Walk the sentence, replacing each scored word with a styled span.
  let remaining = sentence;
  let keyIdx = 0;

  for (const wr of wordResults) {
    if (wr.errorType === "Insertion") continue; // inserted words not in reference text
    const wordLower = wr.word.toLowerCase();
    // Case-insensitive search for the word in the remaining text.
    const pos = remaining.toLowerCase().indexOf(wordLower);
    if (pos === -1) {
      // Word not found — skip (shouldn't happen in practice).
      continue;
    }
    // Text before the word.
    if (pos > 0) {
      tokens.push(<span key={`g${keyIdx++}`}>{remaining.slice(0, pos)}</span>);
    }
    const rawWord = remaining.slice(pos, pos + wr.word.length);

    tokens.push(renderWordToken(wr, rawWord, `w${keyIdx++}`));
    remaining = remaining.slice(pos + wr.word.length);
  }

  // Any text after the last matched word.
  if (remaining) {
    tokens.push(<span key={`g${keyIdx++}`}>{remaining}</span>);
  }

  return (
    <p className="rw-speak-sentence-card" lang="en">
      {tokens}
    </p>
  );
}
