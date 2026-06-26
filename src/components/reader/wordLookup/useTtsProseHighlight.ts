"use client";

import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import type { AudioContextValue } from "@/components/ReaderAudioProvider";
import type { Highlight as RwHighlight } from "@/components/ReaderHighlightsProvider";
import {
  buildTokenAlignment,
} from "@/lib/speech/timing-alignment";
import {
  createComparableKey,
  createSpeechBoundaryRegex,
} from "@/lib/speech/timing";
import { collectTextNodes, type TextNodeEntry } from "@/components/reader/wordLookup/highlightMarks";

type ProseWord = {
  startNode: Text;
  start: number;
  endNode: Text;
  end: number;
  scrollElement: Element | null;
};

type ProseToken = {
  node: Text;
  nodeStart: number;
  nodeEnd: number;
  value: string;
  normalized: string;
};

type CssHighlightRegistry = { set(k: string, v: Highlight): void; delete(k: string): void };

function shouldSkipTtsTextNode(node: Text): boolean {
  return Boolean(node.parentElement?.closest(".sr-only"));
}

function collectVisibleTtsTextNodes(container: HTMLElement): TextNodeEntry[] {
  return collectTextNodes(container).filter((entry) => !shouldSkipTtsTextNode(entry.node));
}

function buildProseTokens(entries: TextNodeEntry[]): ProseToken[] {
  const result: ProseToken[] = [];
  for (const entry of entries) {
    const content = entry.node.textContent ?? "";
    const re = createSpeechBoundaryRegex();
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      const value = m[0];
      const nodeStart = m.index;
      result.push({
        node: entry.node,
        nodeStart,
        nodeEnd: nodeStart + value.length,
        value,
        normalized: createComparableKey(value),
      });
    }
  }
  return result;
}

function rangeFromProseTokens(firstToken: ProseToken, lastToken: ProseToken): ProseWord {
  return {
    startNode: firstToken.node,
    start: firstToken.nodeStart,
    endNode: lastToken.node,
    end: lastToken.nodeEnd,
    scrollElement: firstToken.node.parentElement,
  };
}

function buildProseWordMap(
  container: HTMLElement,
  words: Array<{ word: string }>,
): Array<ProseWord | null> {
  const result: Array<ProseWord | null> = new Array(words.length).fill(null);
  if (words.length === 0) return result;

  const entries = collectVisibleTtsTextNodes(container);
  const proseTokens = buildProseTokens(entries);
  const { alignment, spanLengths } = buildTokenAlignment(proseTokens, words);

  for (let wordIndex = 0; wordIndex < words.length; wordIndex++) {
    const tokenIndex = alignment[wordIndex];
    if (tokenIndex == null) continue;

    const spanLength = Math.max(1, spanLengths[wordIndex] ?? 1);
    const firstToken = proseTokens[tokenIndex];
    const lastToken = proseTokens[tokenIndex + spanLength - 1] ?? firstToken;
    if (firstToken && lastToken) {
      result[wordIndex] = rangeFromProseTokens(firstToken, lastToken);
    }
  }

  return result;
}

export function useTtsProseHighlight(
  proseRef: RefObject<HTMLElement | null>,
  readerAudio: AudioContextValue,
  highlights: RwHighlight[],
) {
  const ttsWordMapRef = useRef<Array<ProseWord | null>>([]);

  useEffect(() => {
    if (!proseRef.current || readerAudio.words.length === 0) {
      ttsWordMapRef.current = [];
      return;
    }
    ttsWordMapRef.current = buildProseWordMap(proseRef.current, readerAudio.words);
  }, [proseRef, readerAudio.words, highlights]);

  useEffect(() => {
    const cssh =
      typeof CSS !== "undefined" && "highlights" in CSS
        ? (CSS.highlights as unknown as CssHighlightRegistry)
        : null;
    if (!cssh) return;

    const idx = readerAudio.activeIndex;
    const map = ttsWordMapRef.current;
    if (idx < 0 || idx >= map.length) {
      cssh.delete("tts-active");
      return;
    }

    const active = map[idx];
    if (!active) {
      cssh.delete("tts-active");
      return;
    }

    let range: Range;
    try {
      range = new Range();
      range.setStart(active.startNode, active.start);
      range.setEnd(active.endNode, Math.min(active.end, active.endNode.length));
    } catch {
      cssh.delete("tts-active");
      return;
    }
    cssh.set("tts-active", new Highlight(range));

    if (readerAudio.listenActive) {
      const rects = range.getClientRects();
      if (rects.length > 0) {
        const rect = rects[0];
        const viewTop = window.innerHeight * 0.2;
        const viewBottom = window.innerHeight * 0.75;
        if (rect.top < viewTop || rect.bottom > viewBottom) {
          active.scrollElement?.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }
    }

    return () => {
      cssh.delete("tts-active");
    };
  }, [readerAudio.activeIndex, readerAudio.listenActive, readerAudio.words, highlights]);
}
