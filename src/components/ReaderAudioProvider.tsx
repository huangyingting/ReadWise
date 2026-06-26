"use client";

/**
 * ReaderAudioProvider (M5 / REF-030)
 *
 * Hoists a single <audio> element + active-word index into React context so
 * both the Listen tab transcript and the ReaderMiniPlayer share ONE player
 * with zero duplicate <audio> elements.
 *
 * Architecture:
 *  - ArticleSpeech fetches speech data on first tab activation, then calls
 *    `loadAudio(src, words, voice, cached, plainText)` to seed the provider.
 *  - ReaderMiniPlayer reads `audioRef` to drive transport controls.
 *  - Both components read `activeIndex` for highlight / time display.
 *  - Internals are split into focused sub-modules (REF-030):
 *      useNarrationApi   — POST /speech fetch + Blob URL lifecycle
 *      useActiveWord     — binary-search active-word index
 *      useLoopSegment    — sentence-loop capture + seek
 */

import {
  createContext,
  useContext,
  useRef,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import {
  segmentDictation,
  type DictationSegment,
  type SpeechWordTiming,
} from "@/lib/dictation";
import { type SpeechWord } from "@/lib/speech/timing";
import { useNarrationApi } from "@/components/reader/useNarrationApi";
import { useActiveWord } from "@/components/reader/useActiveWord";
import { useLoopSegment } from "@/components/reader/useLoopSegment";

export type { SpeechWord } from "@/lib/speech/timing";

export type AudioContextValue = {
  /** The shared audio element ref — ReaderMiniPlayer drives it. */
  audioRef: React.RefObject<HTMLAudioElement | null>;
  /** The word-timing array for the loaded article. */
  words: SpeechWord[];
  /** Canonical plain text used to generate or import the narration. */
  plainText: string;
  /** Sentence-level segments derived from the plain text + word timings. */
  segments: DictationSegment[];
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
    * with the audio src + word timings + plain text (for segment computation).
   * Idempotent (safe to call on re-fetch).
   */
  loadAudio: (
    src: string,
    ws: SpeechWord[],
    voice: string,
    cached: boolean,
    plainText: string,
  ) => void;
  /** Mark fallback so the mini-player never appears. */
  markFallback: () => void;
  /** Whether narration is currently being fetched. */
  isWarming: boolean;
  /** Error from the last narration fetch (null = none). */
  warmError: string | null;
  /**
   * Fetch narration for the article and seed the player. Idempotent — only the
   * first successful call performs the network request; a failed call may be
   * retried. Called by the chrome Listen button.
   */
  warmNarration: (articleId: string) => Promise<void>;
  /** Whether sentence-loop mode is currently active. */
  isLooping: boolean;
  /**
   * Toggle sentence-loop mode. When turning on, captures the sentence
   * containing the current playback position. Turning on again or calling
   * while no speech is loaded is a no-op. Calling while looping cancels.
   */
  toggleLoop: () => void;
};

const ReaderAudioContext = createContext<AudioContextValue | null>(null);

export function ReaderAudioProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const [audioSrc, setAudioSrc] = useState<string | null>(null);
  const [words, setWords] = useState<SpeechWord[]>([]);
  const [plainTextState, setPlainTextState] = useState("");
  const [segments, setSegments] = useState<DictationSegment[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isFallback, setIsFallback] = useState(false);
  const [listenActive, setListenActiveState] = useState(false);
  const [voiceMeta, setVoiceMeta] = useState<{
    voice: string;
    cached: boolean;
  } | null>(null);

  // ── Sub-hooks ─────────────────────────────────────────────────────────────
  const { activeIndex, updateActiveWord, clearActiveWord } = useActiveWord(words);
  const { isLooping, loopSegmentRef, toggleLoop, cancelLoop } = useLoopSegment(
    segments,
    audioRef,
  );

  const setListenActive = useCallback((v: boolean) => {
    setListenActiveState(v);
  }, []);

  const loadAudio = useCallback(
    (
      src: string,
      ws: SpeechWord[],
      voice: string,
      cached: boolean,
      plainText: string,
    ) => {
      setAudioSrc(src);
      setWords(ws);
      setPlainTextState(plainText);
      const segs = segmentDictation(plainText, ws as SpeechWordTiming[]);
      setSegments(segs);
      setIsLoaded(true);
      setIsFallback(false);
      setVoiceMeta({ voice, cached });
      // Cancel any active loop when new audio is loaded.
      cancelLoop();
    },
    [cancelLoop],
  );

  const markFallback = useCallback(() => {
    setIsLoaded(true);
    setIsFallback(true);
    setPlainTextState("");
  }, []);

  // ── Narration API adapter ─────────────────────────────────────────────────
  const { isWarming, warmError, warmNarration } = useNarrationApi({
    onLoaded: loadAudio,
    onFallback: markFallback,
  });

  // ── Time-update handler: update active word + enforce sentence loop ────────
  const handleTimeUpdate = useCallback(
    (time: number) => {
      updateActiveWord(time);
      const seg = loopSegmentRef.current;
      if (seg && time >= seg.endTime - 0.05) {
        const audio = audioRef.current;
        if (audio) audio.currentTime = seg.startTime;
      }
    },
    [updateActiveWord, loopSegmentRef],
  );

  return (
    <ReaderAudioContext.Provider
      value={{
        audioRef,
        words,
        plainText: plainTextState,
        segments,
        activeIndex,
        isLoaded,
        isFallback,
        voiceMeta,
        listenActive,
        setListenActive,
        loadAudio,
        markFallback,
        isWarming,
        warmError,
        warmNarration,
        isLooping,
        toggleLoop,
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
          onTimeUpdate={(e) => handleTimeUpdate(e.currentTarget.currentTime)}
          onSeeked={(e) => updateActiveWord(e.currentTarget.currentTime)}
          onEnded={() => {
            clearActiveWord();
            cancelLoop();
          }}
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
