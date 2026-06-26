"use client";

/**
 * useActiveWord — binary-search audio DOM hook (REF-030).
 *
 * Extracted from ReaderAudioProvider.  Tracks the index of the currently
 * highlighted word during audio playback by binary-searching the word-timing
 * array.  The caller drives the hook by passing the current playback time via
 * `updateActiveWord`.
 */

import { useCallback, useState } from "react";
import { timingStartSeconds, timingEndSeconds, type SpeechWord } from "@/lib/speech/timing";

export interface ActiveWordHook {
  /** Index of the currently highlighted word (-1 = none). */
  activeIndex: number;
  /** Update the active word index for the given playback time. */
  updateActiveWord: (time: number) => void;
  /** Reset the active word index to -1 (e.g. on audio end). */
  clearActiveWord: () => void;
}

export function useActiveWord(words: SpeechWord[]): ActiveWordHook {
  const [activeIndex, setActiveIndex] = useState(-1);

  const updateActiveWord = useCallback(
    (time: number) => {
      if (!words || words.length === 0) return;
      let lo = 0,
        hi = words.length - 1,
        found = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (timingStartSeconds(words[mid]) <= time) {
          found = mid;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      // Clear the active index when sitting in trailing silence past the word.
      if (found !== -1 && time >= timingEndSeconds(words[found]) + 0.4) {
        const next = words[found + 1];
        if (!next || time < timingStartSeconds(next)) {
          found = -1;
        }
      }
      setActiveIndex((prev) => (prev === found ? prev : found));
    },
    [words],
  );

  const clearActiveWord = useCallback(() => setActiveIndex(-1), []);

  return { activeIndex, updateActiveWord, clearActiveWord };
}
