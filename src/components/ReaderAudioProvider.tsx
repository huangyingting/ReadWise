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
 *    `loadAudio(src, words, voice, cached, plainText)` to seed the provider.
 *  - ReaderMiniPlayer reads `audioRef` to drive transport controls.
 *  - Both components read `activeIndex` for highlight / time display.
 *  - updateActiveWord (binary-search) is MOVED here from ArticleSpeech so
 *    the single onTimeUpdate handler on the shared <audio> updates both views.
 *  - Loop: `toggleLoop()` captures the current sentence segment and loops it;
 *    a second call cancels. The `isLooping` flag drives the UI toggle state.
 */

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { postJson } from "@/lib/client-fetch";
import {
  segmentDictation,
  type DictationSegment,
  type SpeechWordTiming,
} from "@/lib/dictation";
import { timingEndSeconds, timingStartSeconds, type SpeechWord } from "@/lib/speech-timing";

export type { SpeechWord } from "@/lib/speech-timing";

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
  const [activeIndex, setActiveIndex] = useState(-1);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isFallback, setIsFallback] = useState(false);
  const [listenActive, setListenActiveState] = useState(false);
  const [voiceMeta, setVoiceMeta] = useState<{
    voice: string;
    cached: boolean;
  } | null>(null);
  // Loop state: the sentence segment currently being looped (null = not looping).
  const loopSegmentRef = useRef<DictationSegment | null>(null);
  const [isLooping, setIsLooping] = useState(false);

  const setListenActive = useCallback((v: boolean) => {
    setListenActiveState(v);
  }, []);

  /** Binary-search: find the last word whose offset <= currentTime. */
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
      // If we're sitting in trailing silence well past the last word, clear.
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

  /** If looping, seek back to sentence start whenever we pass the end. */
  const handleTimeUpdate = useCallback(
    (time: number) => {
      updateActiveWord(time);
      const seg = loopSegmentRef.current;
      if (seg && time >= seg.endTime - 0.05) {
        const audio = audioRef.current;
        if (audio) {
          audio.currentTime = seg.startTime;
        }
      }
    },
    [updateActiveWord],
  );

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
      // Compute sentence segments from plain text + word timings.
      const segs = segmentDictation(plainText, ws as SpeechWordTiming[]);
      setSegments(segs);
      setIsLoaded(true);
      setIsFallback(false);
      setVoiceMeta({ voice, cached });
      // Cancel any active loop when new audio is loaded.
      loopSegmentRef.current = null;
      setIsLooping(false);
    },
    [],
  );

  const markFallback = useCallback(() => {
    setIsLoaded(true);
    setIsFallback(true);
    setPlainTextState("");
  }, []);

  // ── Narration fetch (moved here from ArticleSpeech so the chrome Listen
  //    button can warm narration without mounting a dedicated panel) ──────────
  const [isWarming, setIsWarming] = useState(false);
  const [warmError, setWarmError] = useState<string | null>(null);
  const hasWarmedRef = useRef(false);
  const blobUrlRef = useRef<string | null>(null);

  const warmNarration = useCallback(
    async (articleId: string) => {
      if (hasWarmedRef.current) return;
      hasWarmedRef.current = true;
      setIsWarming(true);
      setWarmError(null);
      try {
        const body = await postJson<{
          audio: string | null;
          mimeType: string | null;
          plainText: string;
          words: SpeechWord[];
          voice: string;
          cached: boolean;
          fallback: boolean;
        }>(`/api/reader/${articleId}/speech`, {});
        if (body.fallback || !body.audio) {
          markFallback();
        } else {
          // base64 → blob: URL (data: URIs are blocked by the CSP media-src).
          const base64 = body.audio.includes(",")
            ? body.audio.split(",")[1]
            : body.audio;
          const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
          const blob = new Blob([bytes], {
            type: body.mimeType ?? "audio/mpeg",
          });
          const blobUrl = URL.createObjectURL(blob);
          if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
          blobUrlRef.current = blobUrl;
          loadAudio(blobUrl, body.words, body.voice, body.cached, body.plainText);
        }
      } catch (err) {
        // Allow a retry on failure.
        hasWarmedRef.current = false;
        setWarmError(
          err instanceof Error ? err.message : "Could not load narration",
        );
      } finally {
        setIsWarming(false);
      }
    },
    [loadAudio, markFallback],
  );

  // Revoke the blob URL when the provider unmounts to avoid memory leaks.
  useEffect(
    () => () => {
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    },
    [],
  );

  const toggleLoop = useCallback(() => {
    if (loopSegmentRef.current) {
      // Cancel loop.
      loopSegmentRef.current = null;
      setIsLooping(false);
      return;
    }
    // Find the segment containing the current playback time.
    const audio = audioRef.current;
    if (!audio) return;
    const time = audio.currentTime;
    const segs = segments;
    if (segs.length === 0) return;
    // Find the last segment whose startTime <= currentTime.
    let seg: DictationSegment | null = null;
    for (const s of segs) {
      if (s.startTime <= time) {
        seg = s;
      } else {
        break;
      }
    }
    // If past all segments, use the last one.
    if (!seg) seg = segs[0];
    loopSegmentRef.current = seg;
    setIsLooping(true);
    // Seek to sentence start if we're past its end.
    if (time >= seg.endTime) {
      audio.currentTime = seg.startTime;
    }
  }, [segments]);

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
            setActiveIndex(-1);
            // Cancel loop when audio ends naturally (i.e. user seeked past last seg).
            loopSegmentRef.current = null;
            setIsLooping(false);
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
