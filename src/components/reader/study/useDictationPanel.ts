"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import { useReaderAudio } from "@/components/ReaderAudioProvider";
import { useAudioRangePlayback } from "@/components/reader/useAudioRangePlayback";
import {
  segmentDictation,
  gradeDictation,
  type DictationSegment,
  type DiffToken,
} from "@/lib/dictation";

export type DictationPhase =
  | "warming"
  | "idle"
  | "playing"
  | "typed"
  | "graded"
  | "fallback"
  | "error";

export type DictationGradeResult = ReturnType<typeof gradeDictation>;

export type UseDictationPanelResult = {
  phase: DictationPhase;
  errorMsg: string | null;
  segments: DictationSegment[];
  currentIdx: number;
  currentSegment: DictationSegment | null;
  typed: string;
  grade: DictationGradeResult | null;
  handlePlay: () => void;
  handleStop: () => void;
  handleTyped: (e: ChangeEvent<HTMLTextAreaElement>) => void;
  handleCheck: (e: FormEvent) => void;
  handleReset: () => void;
  handlePrev: () => void;
  handleNext: () => void;
};

function hasUsableAudioSegments(
  isLoaded: boolean,
  isFallback: boolean,
  wordCount: number,
  segmentCount: number,
): boolean {
  return isLoaded && !isFallback && wordCount > 0 && segmentCount === 0;
}

/**
 * useDictationPanel
 *
 * Data + interaction hook for the dictation study panel. Handles:
 *   - Narration warm / load (via ReaderAudioProvider)
 *   - Sentence segmentation
 *   - Play / stop audio range playback
 *   - Typed text and grading state
 *   - Sentence navigation (prev / next)
 *   - Active-tab visibility: stops playback when panel hides
 */
export function useDictationPanel(
  articleId: string,
  plainText: string,
  active: boolean,
): UseDictationPanelResult {
  const audio = useReaderAudio();
  const {
    audioRef,
    isLoaded,
    isFallback,
    words,
    plainText: narrationText,
    warmError,
    warmNarration,
  } = audio;

  const [phase, setPhase] = useState<DictationPhase>("warming");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [segments, setSegments] = useState<DictationSegment[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [typed, setTyped] = useState("");
  const [grade, setGrade] = useState<DictationGradeResult | null>(null);

  const warmStartedRef = useRef(false);
  const { playRange, stopRange } = useAudioRangePlayback(audioRef);
  const resetAnswerState = useCallback(() => {
    stopRange({ pause: true });
    setTyped("");
    setGrade(null);
    setPhase("idle");
  }, [stopRange]);

  // Stop playback when tab becomes hidden or overlay closes.
  useEffect(() => {
    if (active) return;
    stopRange({ pause: true });
    setPhase((p) => (p === "playing" ? "idle" : p));
  }, [active, stopRange]);

  // When audio is already loaded, compute sentence segments.
  useEffect(() => {
    if (hasUsableAudioSegments(isLoaded, isFallback, words.length, segments.length)) {
      const segs = segmentDictation(narrationText || plainText, words);
      setSegments(segs);
      setPhase(segs.length > 0 ? "idle" : "fallback");
    } else if (isFallback && phase === "warming") {
      setPhase("fallback");
    } else if (warmError && phase === "warming") {
      setErrorMsg(warmError);
      setPhase("error");
    }
  }, [isLoaded, isFallback, words, narrationText, warmError, plainText, segments.length, phase]);

  // Warm narration lazily on first render if not already loaded.
  useEffect(() => {
    if (warmStartedRef.current || isLoaded) return;
    warmStartedRef.current = true;
    void warmNarration(articleId);
  }, [articleId, isLoaded, warmNarration]);

  const currentSegment = segments[currentIdx] ?? null;

  const handlePlay = useCallback(() => {
    if (!currentSegment) return;
    const started = playRange(currentSegment, {
      onEnd: () => setPhase((p) => (p === "playing" ? "idle" : p)),
    });
    if (started) setPhase("playing");
  }, [currentSegment, playRange]);

  const handleStop = useCallback(() => {
    stopRange({ pause: true });
    setPhase("idle");
  }, [stopRange]);

  const handleTyped = useCallback((e: ChangeEvent<HTMLTextAreaElement>) => {
    setTyped(e.target.value);
    if (grade) setGrade(null);
    setPhase("typed");
  }, [grade]);

  const handleCheck = useCallback((e: FormEvent) => {
    e.preventDefault();
    if (!currentSegment || !typed.trim()) return;
    stopRange({ pause: true });
    setGrade(gradeDictation(currentSegment.text, typed));
    setPhase("graded");
  }, [currentSegment, stopRange, typed]);

  const handleReset = useCallback(() => {
    resetAnswerState();
  }, [resetAnswerState]);

  const handlePrev = useCallback(() => {
    resetAnswerState();
    setCurrentIdx((i) => Math.max(0, i - 1));
  }, [resetAnswerState]);

  const handleNext = useCallback(() => {
    resetAnswerState();
    setCurrentIdx((i) => Math.min(segments.length - 1, i + 1));
  }, [resetAnswerState, segments.length]);

  return {
    phase,
    errorMsg,
    segments,
    currentIdx,
    currentSegment,
    typed,
    grade,
    handlePlay,
    handleStop,
    handleTyped,
    handleCheck,
    handleReset,
    handlePrev,
    handleNext,
  };
}

export type { DictationSegment, DiffToken };
