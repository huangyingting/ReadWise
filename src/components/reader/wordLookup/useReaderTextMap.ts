"use client";

import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import type { AudioContextValue } from "@/components/ReaderAudioProvider";
import type { Highlight as RwHighlight } from "@/components/ReaderHighlightsProvider";
import { applyHighlightMarks } from "./highlightMarks";
import {
  buildProseWordMap,
  useActiveTtsProseHighlight,
  type ProseWord,
} from "./useTtsProseHighlight";

type NarrationWord = {
  word: string;
  textStart?: number;
  textEnd?: number;
};

export function synchronizeReaderTextMap(
  container: HTMLElement,
  highlights: RwHighlight[],
  onOrphaned: (id: string) => void,
  words: NarrationWord[],
  plainText: string,
): Array<ProseWord | null> {
  applyHighlightMarks(container, highlights, onOrphaned);
  return buildProseWordMap(container, words, plainText);
}

/**
 * Owns the Reader prose mutation order: persistent marks are rendered first,
 * then Narration ranges are rebuilt against the resulting live text nodes.
 */
export function useReaderTextMap(
  proseRef: RefObject<HTMLElement | null>,
  proseRevision: unknown,
  readerAudio: AudioContextValue,
  highlights: RwHighlight[],
  onOrphaned: (id: string) => void,
): void {
  const ttsWordMapRef = useRef<Array<ProseWord | null>>([]);

  useEffect(() => {
    const prose = proseRef.current;
    if (!prose) {
      ttsWordMapRef.current = [];
      return;
    }
    ttsWordMapRef.current = synchronizeReaderTextMap(
      prose,
      highlights,
      onOrphaned,
      readerAudio.words,
      readerAudio.plainText,
    );
  }, [
    proseRef,
    proseRevision,
    highlights,
    onOrphaned,
    readerAudio.words,
    readerAudio.plainText,
  ]);

  useActiveTtsProseHighlight(
    ttsWordMapRef,
    readerAudio,
    highlights,
    proseRevision,
  );
}