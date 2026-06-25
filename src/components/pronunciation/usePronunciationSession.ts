"use client";

/**
 * usePronunciationSession — pronunciation practice state machine.
 *
 * Owns all phase transitions, token lifecycle, mic recording, assessment,
 * persistence, history, sentence navigation, and cleanup.
 * The component that renders the UI only orchestrates audio and JSX.
 */

import { useEffect, useRef, useState } from "react";
import { useMicLevelMeter } from "@/components/reader/useMicLevelMeter";
import { usePronunciationAssessment } from "@/components/reader/usePronunciationAssessment";
import { usePronunciationHistory } from "@/components/reader/usePronunciationHistory";
import { usePronunciationPersistence } from "@/components/reader/usePronunciationPersistence";
import { useRecordingCountdown } from "@/components/reader/useRecordingCountdown";
import { useSpeechToken } from "@/components/reader/useSpeechToken";
import type {
  AssessResult,
  SavedNote,
  SentenceHistory,
} from "@/components/reader/pronunciationTypes";

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_RECORD_MS = 20_000; // 20 s auto-stop safety net
const COUNTDOWN_START_S = 5; // show countdown in last N seconds

// ─── Types ────────────────────────────────────────────────────────────────────

export type PronunciationPhase =
  | "init"        // first activation; token fetch in progress
  | "idle"
  | "recording"
  | "processing"
  | "result"
  | "unavailable" // speech not configured
  | "mic-denied"  // NotAllowedError
  | "no-device"   // NotFoundError
  | "error";      // transient network/SDK error

export type PronunciationSessionState = {
  phase: PronunciationPhase;
  errorMsg: string | null;
  result: AssessResult | null;
  meterLevel: number;
  secondsRemaining: number | null;
  currentIndex: number;
  currentSentence: string;
  sentenceCount: number;
  sentenceHistory: SentenceHistory;
  savedNote: SavedNote;
  isNewBest: boolean;
  goPrev: () => void;
  goNext: () => void;
  handleRecord: () => Promise<void>;
  handleStop: () => Promise<void>;
  handleRecordAgain: () => void;
  handleRetry: () => Promise<void>;
  handleMicDeniedRetry: () => void;
  handleNoDeviceRetry: () => void;
};

type Options = {
  active: boolean;
  articleId: string;
  sentences: string[];
  currentBlockText?: string;
  /**
   * Called right before the microphone opens (e.g. pause model narration).
   * Only invoked after a successful token refresh.
   */
  stopPlayback?: () => void;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Finds the index of the first sentence belonging to the given paragraph block.
 * Strategy: if the block text contains the first 20 chars of a sentence it is
 * considered "in" that paragraph (#377).
 */
function findSentenceIndexForBlock(
  sentences: string[],
  blockText: string,
): number {
  if (!blockText || sentences.length === 0) return 0;
  const normalised = blockText.trim();
  for (let i = 0; i < sentences.length; i++) {
    const probe = sentences[i].trim().slice(0, 20);
    if (probe && normalised.includes(probe)) return i;
  }
  return 0;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function usePronunciationSession({
  active,
  articleId,
  sentences,
  currentBlockText,
  stopPlayback,
}: Options): PronunciationSessionState {
  const [phase, setPhase] = useState<PronunciationPhase>("init");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [result, setResult] = useState<AssessResult | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);

  const sentenceCount = sentences.length;
  const currentSentence = sentences[currentIndex] ?? "";

  const { meterLevel, startMeter, stopMeter } = useMicLevelMeter();
  const { runPronunciationAssessment, closeRecognizer } = usePronunciationAssessment();
  const { rememberToken, fetchToken } = useSpeechToken();
  const { secondsRemaining, startAutoStop, stopCountdown, cancelAutoStop } =
    useRecordingCountdown({
      maxRecordMs: MAX_RECORD_MS,
      countdownStartSeconds: COUNTDOWN_START_S,
    });
  const { sentenceHistory, loadHistory, addAttempt } =
    usePronunciationHistory(currentSentence);
  const { savedNote, isNewBest, resetPersistence, persistAttempt } =
    usePronunciationPersistence();

  const hasFetchedToken = useRef(false);

  // ── First activation: fetch token + load history ──────────────────────────
  useEffect(() => {
    if (!active || hasFetchedToken.current) return;
    hasFetchedToken.current = true;
    void initSpeakTab();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // ── #377: Default to the current reading paragraph when first activated ───
  // Once the tab transitions from "init" to "idle" and the user has not yet
  // manually navigated, jump to the first sentence of the current paragraph.
  const hasJumpedToBlockRef = useRef(false);
  useEffect(() => {
    if (phase !== "idle") return;
    if (hasJumpedToBlockRef.current) return;
    if (!currentBlockText) return;
    hasJumpedToBlockRef.current = true;
    const idx = findSentenceIndexForBlock(sentences, currentBlockText);
    if (idx !== 0) setCurrentIndex(idx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // ── Changing sentence resets state ────────────────────────────────────────
  const prevSentenceRef = useRef<string>("");
  useEffect(() => {
    if (prevSentenceRef.current !== currentSentence) {
      prevSentenceRef.current = currentSentence;
      if (phase === "recording") {
        void stopRecording(false);
      }
      if (
        phase === "result" ||
        phase === "recording" ||
        phase === "processing"
      ) {
        setPhase("idle");
        setResult(null);
        resetPersistence();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSentence]);

  // ── Cleanup on unmount ────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      stopMeter();
      cancelAutoStop();
      closeRecognizer();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Stop mic when the tab becomes hidden or the overlay closes ────────────
  useEffect(() => {
    if (active) return;
    if (phase === "recording") {
      void stopRecording(false);
    }
    stopMeter();
    cancelAutoStop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // ─────────────────────────────────────────────────────────────────────────
  // Core async handlers
  // ─────────────────────────────────────────────────────────────────────────

  async function initSpeakTab() {
    setPhase("init");
    const [tokenResult] = await Promise.all([fetchToken(), loadHistory()]);
    if (tokenResult.status !== "ok") {
      if (tokenResult.status === "transient") {
        if (tokenResult.message) setErrorMsg(tokenResult.message);
        setPhase("error");
      } else {
        setPhase("unavailable");
      }
      return;
    }
    rememberToken(tokenResult.token, tokenResult.region);
    setPhase("idle");
  }

  async function handleRecord() {
    // Re-fetch a fresh token on every record attempt (tokens expire in ~10 min).
    const freshToken = await fetchToken();
    if (freshToken.status !== "ok") {
      setPhase(freshToken.status === "unconfigured" ? "unavailable" : "error");
      if (freshToken.status === "transient" && freshToken.message) {
        setErrorMsg(freshToken.message);
      } else {
        setErrorMsg(
          errorMsg ??
            "Could not reach the speech service. Check your connection and try again.",
        );
      }
      return;
    }
    rememberToken(freshToken.token, freshToken.region);

    // Pause any playing narration before opening the microphone.
    stopPlayback?.();

    setPhase("recording");
    setResult(null);
    resetPersistence();

    // Start Web Audio level meter (separate getUserMedia call — mic permission
    // already granted, browser reuses the device without a second dialog).
    await startMeter();

    // Start countdown + auto-stop safety timer.
    startAutoStop(() => {
      void stopRecording(true);
    });

    // Run assessment.
    try {
      const assessment = await runPronunciationAssessment(
        freshToken.token,
        freshToken.region,
        currentSentence,
      );
      cancelAutoStop();
      stopMeter();
      setPhase("processing");
      // Small deliberate pause so the UI visually transitions.
      await new Promise<void>((r) => setTimeout(r, 400));
      setResult(assessment);
      setPhase("result");
      // Fire-and-forget persist.
      void persistAttempt({
        articleId,
        assessment,
        referenceText: currentSentence,
        priorBest: sentenceHistory.best,
        onSaved: addAttempt,
      });
    } catch (err) {
      cancelAutoStop();
      stopMeter();
      const msg = err instanceof Error ? err.message : "Recognition failed";
      if (
        msg.includes("NotAllowedError") ||
        msg.toLowerCase().includes("permission")
      ) {
        setPhase("mic-denied");
      } else if (
        msg.includes("NotFoundError") ||
        msg.toLowerCase().includes("no device")
      ) {
        setPhase("no-device");
      } else {
        setPhase("error");
        setErrorMsg(
          "Something went wrong scoring that. Check your connection and try again.",
        );
      }
    }
  }

  async function stopRecording(andProcess: boolean) {
    cancelAutoStop();
    stopCountdown();
    stopMeter();
    if (!andProcess) {
      closeRecognizer();
      setPhase("idle");
      return;
    }
    // Allow the SDK's recognizeOnceAsync to resolve naturally after closing.
    closeRecognizer();
  }

  async function handleRetry() {
    setPhase("idle");
    setErrorMsg(null);
    const t = await fetchToken();
    if (t.status === "ok") rememberToken(t.token, t.region);
  }

  function handleRecordAgain() {
    setResult(null);
    setPhase("idle");
    resetPersistence();
  }

  function handleMicDeniedRetry() {
    setPhase("idle");
    setErrorMsg(null);
  }

  function handleNoDeviceRetry() {
    setPhase("idle");
    setErrorMsg(null);
  }

  function goPrev() {
    if (currentIndex > 0) setCurrentIndex((i) => i - 1);
  }

  function goNext() {
    if (currentIndex < sentenceCount - 1) setCurrentIndex((i) => i + 1);
  }

  return {
    phase,
    errorMsg,
    result,
    meterLevel,
    secondsRemaining,
    currentIndex,
    currentSentence,
    sentenceCount,
    sentenceHistory,
    savedNote,
    isNewBest,
    goPrev,
    goNext,
    handleRecord,
    handleStop: async () => stopRecording(true),
    handleRecordAgain,
    handleRetry,
    handleMicDeniedRetry,
    handleNoDeviceRetry,
  };
}
