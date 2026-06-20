"use client";

/**
 * ReaderAudioProvider (M5)
 *
 * Hoists a single <audio> element + active-word index into React context so
 * both the Listen tab transcript and the ReaderMiniPlayer share ONE player
 * with zero duplicate <audio> elements.
 *
 * Architecture:
 *  - ArticleSpeech fetches speech data on first tab activation, then calls
 *    `loadAudio(src, words, voice, cached)` to seed the provider.
 *  - ReaderMiniPlayer reads `audioRef` to drive transport controls.
 *  - Both components read `activeIndex` for highlight / time display.
 *  - updateActiveWord (binary-search) is MOVED here from ArticleSpeech so
 *    the single onTimeUpdate handler on the shared <audio> updates both views.
 */

import {
  createContext,
  useContext,
  useRef,
  useState,
  useCallback,
  type ReactNode,
} from "react";

export type SpeechWord = {
  textOffset: number;
  length: number;
  start: number;
  end: number;
};

export type AudioContextValue = {
  /** The shared audio element ref — ReaderMiniPlayer drives it. */
  audioRef: React.RefObject<HTMLAudioElement | null>;
  /** The word-timing array for the loaded article. */
  words: SpeechWord[];
  /** Index of the currently highlighted word (-1 = none). */
  activeIndex: number;
  /** Whether narration data has been loaded (may still be fallback). */
  isLoaded: boolean;
  /** True when the API returned fallback:true (speech unconfigured). */
  isFallback: boolean;
  /** Voice metadata returned by the API. */
  voiceMeta: { voice: string; cached: boolean } | null;
  /**
   * True while the Listen tab is the active visible panel. WordLookup reads
   * this to gate auto-scroll of the prose TTS highlight (so background
   * playback on another tab never hijacks the user's reading scroll).
   */
  listenActive: boolean;
  /** Called by ArticleSpeech to set/unset the listenActive gate. */
  setListenActive: (v: boolean) => void;
  /**
   * Called by ArticleSpeech after a successful fetch to seed the provider
   * with the audio src + word timings. Idempotent (safe to call on re-fetch).
   */
  loadAudio: (
    src: string,
    ws: SpeechWord[],
    voice: string,
    cached: boolean,
  ) => void;
  /** Mark fallback so the mini-player never appears. */
  markFallback: () => void;
};

const ReaderAudioContext = createContext<AudioContextValue | null>(null);

export function ReaderAudioProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const [audioSrc, setAudioSrc] = useState<string | null>(null);
  const [words, setWords] = useState<SpeechWord[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isFallback, setIsFallback] = useState(false);
  const [listenActive, setListenActiveState] = useState(false);
  const [voiceMeta, setVoiceMeta] = useState<{
    voice: string;
    cached: boolean;
  } | null>(null);

  const setListenActive = useCallback((v: boolean) => {
    setListenActiveState(v);
  }, []);

  /** Binary-search: find the last word whose start <= currentTime. */
  const updateActiveWord = useCallback(
    (time: number) => {
      if (!words || words.length === 0) return;
      let lo = 0,
        hi = words.length - 1,
        found = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (words[mid].start <= time) {
          found = mid;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      // If we're sitting in trailing silence well past the last word, clear.
      if (found !== -1 && time >= words[found].end + 0.4) {
        const next = words[found + 1];
        if (!next || time < next.start) {
          found = -1;
        }
      }
      setActiveIndex((prev) => (prev === found ? prev : found));
    },
    [words],
  );

  const loadAudio = useCallback(
    (src: string, ws: SpeechWord[], voice: string, cached: boolean) => {
      setAudioSrc(src);
      setWords(ws);
      setIsLoaded(true);
      setIsFallback(false);
      setVoiceMeta({ voice, cached });
    },
    [],
  );

  const markFallback = useCallback(() => {
    setIsLoaded(true);
    setIsFallback(true);
  }, []);

  return (
    <ReaderAudioContext.Provider
      value={{
        audioRef,
        words,
        activeIndex,
        isLoaded,
        isFallback,
        voiceMeta,
        listenActive,
        setListenActive,
        loadAudio,
        markFallback,
      }}
    >
      {/* Single <audio> element for the whole reader page. */}
      {audioSrc ? (
        <audio
          ref={audioRef}
          src={audioSrc}
          preload="metadata"
          className="reader-sr-live"
          style={{ display: "none" }}
          onTimeUpdate={(e) => updateActiveWord(e.currentTarget.currentTime)}
          onSeeked={(e) => updateActiveWord(e.currentTarget.currentTime)}
          onEnded={() => setActiveIndex(-1)}
        />
      ) : (
        // Keep ref stable even when no audio yet.
        <audio ref={audioRef} style={{ display: "none" }} />
      )}
      {children}
    </ReaderAudioContext.Provider>
  );
}

export function useReaderAudio(): AudioContextValue {
  const ctx = useContext(ReaderAudioContext);
  if (!ctx) {
    throw new Error("useReaderAudio must be used within ReaderAudioProvider");
  }
  return ctx;
}
