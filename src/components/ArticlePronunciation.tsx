"use client";

/**
 * ArticlePronunciation (M16)
 *
 * "Speak" tab panel — browser-side pronunciation assessment via the Azure
 * Speech SDK. Never imports the SDK at module level (SSR-safe); loads it
 * dynamically inside the record handler.
 *
 * Flow:
 *   idle → [Record] → recording (mic meter + pulse) → processing → result
 *                                              ↑ stop / auto-stop
 *
 * Graceful states: unavailable (speech unconfigured), mic-denied, no-device,
 * error (network/SDK), all with kind copy + retry where appropriate.
 *
 * Props:
 *   articleId — for API calls and attempt persistence
 *   plainText — article body as plain text (htmlToPlainText output); used to
 *               split sentences and match TTS word timings for "Hear it"
 *   active    — true when the Speak tab is the currently visible panel
 */

// SDK types only — erased at compile time, never bundled for SSR.
// Used for SpeechRecognitionResult in the recognizeOnceAsync callback.
import type { SpeechRecognitionResult } from "microsoft-cognitiveservices-speech-sdk";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Mic,
  MicOff,
  RotateCcw,
  Square,
  Star,
  Volume2,
  Check,
  Info,
} from "lucide-react";
import { cn, focusRing } from "@/lib/cn";
import EmptyState from "@/components/EmptyState";
import AiBadge from "@/components/AiBadge";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { useReaderAudio } from "@/components/ReaderAudioProvider";
import { useAudioRangePlayback } from "@/components/reader/useAudioRangePlayback";
import {
  findSpeechSentenceRange,
  splitPracticeSentences,
} from "@/lib/speech-practice";

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_RECORD_MS = 20_000; // 20 s auto-stop safety net
const COUNTDOWN_START_S = 5; // show countdown in last N seconds
const RING_R = 28;
const RING_C = 2 * Math.PI * RING_R; // ≈ 175.93

// ─── Types ────────────────────────────────────────────────────────────────────

type Phase =
  | "init"       // first activation; token fetch in progress
  | "idle"
  | "recording"
  | "processing"
  | "result"
  | "unavailable" // speech not configured
  | "mic-denied"  // NotAllowedError
  | "no-device"   // NotFoundError
  | "error";      // transient network/SDK error

type WordBand = "good" | "fair" | "poor" | "omitted";

interface WordResult {
  word: string;
  score: number;
  errorType: string;
  band: WordBand;
}

interface AssessResult {
  accuracyScore: number;
  fluencyScore: number;
  completenessScore: number;
  pronScore: number;
  words: WordResult[];
}

interface SentenceHistory {
  best: number | null;
  last: number | null;
}

type SavedNote = "idle" | "saving" | "saved" | "failed";

// ─── Utilities ────────────────────────────────────────────────────────────────

/** Returns the band for a word given its accuracy score and error type. */
function getWordBand(score: number, errorType: string): WordBand {
  if (errorType === "Omission") return "omitted";
  if (score >= 80) return "good";
  if (score >= 60) return "fair";
  return "poor";
}

/** One-word qualitative label for the overall score. */
function scoreLabel(score: number): string {
  if (score >= 85) return "Excellent";
  if (score >= 70) return "Good";
  return "Keep practicing";
}

/** Badge variant for the score label chip. */
function scoreBadgeVariant(score: number): "success" | "warning" | "neutral" {
  if (score >= 85) return "success";
  if (score >= 70) return "warning";
  return "neutral";
}

/** Human-readable band name for sr-only labels. */
function bandSrLabel(band: WordBand): string {
  switch (band) {
    case "good":    return "well pronounced";
    case "fair":    return "close, needs work";
    case "poor":    return "mispronounced";
    case "omitted": return "skipped word";
  }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ScoreRing({ score }: { score: number }) {
  const offset = RING_C * (1 - score / 100);
  const label = scoreLabel(score);
  const variant = scoreBadgeVariant(score);

  return (
    <div className="rw-speak-ring-row">
      <div
        role="img"
        aria-label={`Pronunciation score: ${score} out of 100.`}
        className="rw-speak-ring-wrap"
      >
        <svg viewBox="0 0 72 72" className="rw-speak-ring" aria-hidden>
          {/* Track */}
          <circle
            cx="36"
            cy="36"
            r={RING_R}
            fill="none"
            stroke="var(--reading-border, var(--border))"
            strokeWidth="8"
            strokeLinecap="round"
          />
          {/* Progress arc — teal (reading-state achievement) */}
          <circle
            cx="36"
            cy="36"
            r={RING_R}
            fill="none"
            stroke="var(--teal)"
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={RING_C}
            strokeDashoffset={offset}
          />
        </svg>
        <div className="rw-speak-ring-center" aria-hidden>
          <span className="rw-speak-ring-score">{score}</span>
          <span className="rw-speak-ring-caption">Score</span>
        </div>
      </div>

      {/* Qualitative chip + caption beside ring */}
      <div className="rw-speak-ring-info">
        <p
          className="font-semibold text-[length:var(--text-base)] m-0"
          style={{ color: "var(--reading-text, var(--text))" }}
        >
          Pronunciation
        </p>
        <Badge variant={variant}>{label}</Badge>
      </div>
    </div>
  );
}

function SubBars({
  accuracy,
  fluency,
  completeness,
}: {
  accuracy: number;
  fluency: number;
  completeness: number;
}) {
  const bars = [
    { label: "Accuracy", score: accuracy },
    { label: "Fluency", score: fluency },
    { label: "Completeness", score: completeness },
  ];

  return (
    <div className="rw-speak-subbar-list">
      {bars.map(({ label, score }) => (
        <div key={label} className="rw-speak-subbar-row">
          <span className="rw-speak-subbar-label">{label}</span>
          <div
            role="meter"
            aria-label={`${label}: ${score} out of 100`}
            aria-valuenow={score}
            aria-valuemin={0}
            aria-valuemax={100}
            className="rw-speak-subbar-track"
          >
            <div
              className="rw-speak-subbar-fill"
              style={{ width: `${score}%` }}
            />
          </div>
          <span className="rw-speak-subbar-value" aria-hidden>
            {score}
          </span>
        </div>
      ))}
      <details className="rw-speak-score-legend">
        <summary>
          <Info size={11} aria-hidden />
          What do these mean?
        </summary>
        <div className="rw-speak-score-legend-body">
          <p className="m-0">
            <strong>Accuracy</strong> — how closely phonemes match native pronunciation.
          </p>
          <p className="m-0">
            <strong>Fluency</strong> — how naturally you paced and connected words.
          </p>
          <p className="m-0">
            <strong>Completeness</strong> — the fraction of reference words you spoke.
          </p>
        </div>
      </details>
    </div>
  );
}

function WordDisplay({ sentence, wordResults }: { sentence: string; wordResults: WordResult[] }) {
  // Build a token list from the sentence text + scored words.
  // Match each word result to its position in the sentence (first match, left to right).
  const tokens: ReactNode[] = [];

  if (wordResults.length === 0) {
    // No word data — just show the sentence plainly.
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
      // Word not found — append remaining and continue (shouldn't happen in practice).
      continue;
    }
    // Text before the word.
    if (pos > 0) {
      tokens.push(<span key={`g${keyIdx++}`}>{remaining.slice(0, pos)}</span>);
    }
    const rawWord = remaining.slice(pos, pos + wr.word.length);

    if (wr.band === "good") {
      tokens.push(
        <span
          key={`w${keyIdx++}`}
          className="rw-speak-word rw-speak-word--good"
        >
          {rawWord}
        </span>,
      );
    } else {
      const tooltip = `${rawWord} — ${wr.score}, ${bandSrLabel(wr.band)}`;
      tokens.push(
        <span
          key={`w${keyIdx++}`}
          className={`rw-speak-word rw-speak-word--${wr.band}`}
          data-tooltip={tooltip}
        >
          {rawWord}
          {/* sr-only label for screen readers */}
          <span className="rw-sr-live" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0,0,0,0)", whiteSpace: "nowrap" }}>
            {` (${bandSrLabel(wr.band)})`}
          </span>
        </span>,
      );
    }
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

function WordsToWorkOn({ wordResults }: { wordResults: WordResult[] }) {
  // Filter non-good words, worst first.
  const nonGood = wordResults
    .filter((w) => w.band !== "good" && w.errorType !== "Insertion")
    .sort((a, b) => a.score - b.score);

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

function PronLegend() {
  return (
    <div className="rw-speak-legend" aria-label="Word feedback legend">
      <span className="rw-speak-legend-item">
        <span className="rw-speak-legend-swatch rw-speak-legend-swatch--good" aria-hidden />
        solid = good
      </span>
      <span className="rw-speak-legend-item">
        <span className="rw-speak-legend-swatch rw-speak-legend-swatch--fair" aria-hidden />
        dashed = close
      </span>
      <span className="rw-speak-legend-item">
        <span className="rw-speak-legend-swatch rw-speak-legend-swatch--poor" aria-hidden />
        wavy = needs work
      </span>
      <span className="rw-speak-legend-item">
        <span className="rw-speak-legend-swatch rw-speak-legend-swatch--omit" aria-hidden />
        <s aria-hidden>word</s> = skipped
      </span>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

/**
 * Finds the index of the first sentence that belongs to the given paragraph
 * block text. Used to jump to the current reading position when the Speak
 * tab is first activated (#377).
 *
 * Strategy: the first sentence whose leading characters appear at the start
 * of `blockText` (or within it) is considered to be "in" that paragraph.
 */
function findSentenceIndexForBlock(
  sentences: string[],
  blockText: string,
): number {
  if (!blockText || sentences.length === 0) return 0;
  const normalised = blockText.trim();
  for (let i = 0; i < sentences.length; i++) {
    const s = sentences[i];
    // A sentence belongs to this block if the block text contains the
    // sentence's first 20 characters (tolerant to minor whitespace diff).
    const probe = s.trim().slice(0, 20);
    if (probe && normalised.includes(probe)) return i;
  }
  return 0;
}

export default function ArticlePronunciation({
  articleId,
  plainText,
  active,
  currentBlockText,
}: {
  articleId: string;
  plainText: string;
  active: boolean;
  /** #377: text of the prose block the user is currently reading. When
   *  provided and the panel is in idle state, the component defaults to the
   *  first sentence belonging to that paragraph. */
  currentBlockText?: string;
}) {
  const audio = useReaderAudio();

  // ── Sentence stepper ──────────────────────────────────────────────────────
  const sentences = useMemo(() => splitPracticeSentences(plainText), [plainText]);
  const [currentIndex, setCurrentIndex] = useState(0);

  const currentSentence = sentences[currentIndex] ?? "";
  const sentenceCount = sentences.length;

  // ── State machine ─────────────────────────────────────────────────────────
  const [phase, setPhase] = useState<Phase>("init");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // ── Assessment result ─────────────────────────────────────────────────────
  const [result, setResult] = useState<AssessResult | null>(null);

  // ── Mic level meter ───────────────────────────────────────────────────────
  const [meterLevel, setMeterLevel] = useState(0); // 0–1
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const meterStreamRef = useRef<MediaStream | null>(null);
  const meterAnimRef = useRef<number | null>(null);

  // ── Recording / SDK ───────────────────────────────────────────────────────
  // Stored as a duck-typed "closeable" to avoid bundling MSDK type at module level.
  const recognizerRef = useRef<{ close: () => void } | null>(null);
  const hasFetchedToken = useRef(false);
  const [tokenCache, setTokenCache] = useState<{ token: string; region: string } | null>(null);

  // ── Countdown ─────────────────────────────────────────────────────────────
  const [secondsRemaining, setSecondsRemaining] = useState<number | null>(null);
  const autoStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordingStartRef = useRef<number>(0);

  // ── Per-sentence history ──────────────────────────────────────────────────
  const [allAttempts, setAllAttempts] = useState<
    Array<{ referenceText: string; pronScore: number; createdAt: string }>
  >([]);
  const historyLoaded = useRef(false);

  // ── Attempt persistence ───────────────────────────────────────────────────
  const recordedRef = useRef(false);
  const [savedNote, setSavedNote] = useState<SavedNote>("idle");
  const [isNewBest, setIsNewBest] = useState(false);

  // ── "Hear it" range play cleanup ──────────────────────────────────────────
  const { playRange, stopRange } = useAudioRangePlayback(audio.audioRef);

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
  // This runs ONCE per activation (hasJumpedToBlockRef prevents re-fires on
  // block changes after the user has taken control).
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
      // Only reset if we're in a non-terminal active state.
      if (phase === "recording") {
        void stopRecording(false); // cancel without processing
      }
      if (phase === "result" || phase === "recording" || phase === "processing") {
        setPhase("idle");
        setResult(null);
        setSavedNote("idle");
        setIsNewBest(false);
        recordedRef.current = false;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSentence]);

  // ── Cleanup on unmount ────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      stopMeter();
      cancelAutoStop();
      stopRange();
      recognizerRef.current?.close();
      recognizerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopRange]);

  // ── Stop mic/playback when the tab becomes hidden or the overlay closes ────
  // `active` is `open && activeTab === "speak"`, so this fires when the Speak
  // panel is hidden behind another tab OR the whole overlay is closed (#210).
  useEffect(() => {
    if (active) return;
    if (phase === "recording") {
      void stopRecording(false);
    }
    stopMeter();
    cancelAutoStop();
    stopRange({ pause: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, stopRange]);

  // ── Per-sentence history derived from allAttempts ─────────────────────────
  const sentenceHistory = useMemo<SentenceHistory>(() => {
    if (allAttempts.length === 0 || !currentSentence) return { best: null, last: null };
    const matching = allAttempts.filter(
      (a) => a.referenceText.trim() === currentSentence.trim(),
    );
    if (matching.length === 0) return { best: null, last: null };
    // newest-first from API → last = matching[0].pronScore
    const last = matching[0].pronScore;
    const best = Math.max(...matching.map((a) => a.pronScore));
    return { best, last };
  }, [allAttempts, currentSentence]);

  // ─────────────────────────────────────────────────────────────────────────
  // Core async handlers
  // ─────────────────────────────────────────────────────────────────────────

  async function initSpeakTab() {
    setPhase("init");
    const [tokenResult] = await Promise.all([
      fetchToken(),
      loadHistory(),
    ]);
    if (tokenResult.status !== "ok") {
      if (tokenResult.status === "transient") {
        if (tokenResult.message) setErrorMsg(tokenResult.message);
        setPhase("error");
      } else {
        setPhase("unavailable");
      }
      return;
    }
    setTokenCache({ token: tokenResult.token, region: tokenResult.region });
    setPhase("idle");
  }

  type TokenResult =
    | { status: "ok"; token: string; region: string }
    | { status: "unconfigured" }
    | { status: "transient"; message?: string };

  async function fetchToken(): Promise<TokenResult> {
    try {
      const res = await fetch("/api/speech/token");
      if (!res.ok) {
        const msg =
          res.status === 502
            ? "Speech service is temporarily unavailable. Try again shortly."
            : undefined;
        return { status: "transient", message: msg };
      }
      const data = (await res.json()) as
        | { configured: false }
        | { configured: true; token: string; region: string }
        | { configured: true; error: string };
      if (!data.configured) return { status: "unconfigured" };
      if ("error" in data) {
        return { status: "transient", message: "Speech service is temporarily unavailable." };
      }
      return { status: "ok", token: data.token, region: data.region };
    } catch {
      return { status: "transient" };
    }
  }

  async function loadHistory() {
    if (historyLoaded.current) return;
    historyLoaded.current = true;
    try {
      const res = await fetch("/api/pronunciation/history?limit=100");
      if (!res.ok) return;
      const data = (await res.json()) as {
        attempts: Array<{ referenceText: string; pronScore: number; createdAt: string }>;
      };
      setAllAttempts(data.attempts ?? []);
    } catch {
      // Silent — history is best-effort context.
    }
  }

  async function handleRecord() {
    // Re-fetch a fresh token on every record attempt (tokens expire in ~10 min).
    const freshToken = await fetchToken();
    if (freshToken.status !== "ok") {
      setPhase(freshToken.status === "unconfigured" ? "unavailable" : "error");
      if (freshToken.status === "transient" && freshToken.message) {
        setErrorMsg(freshToken.message);
      } else {
        setErrorMsg(errorMsg ?? "Could not reach the speech service. Check your connection and try again.");
      }
      return;
    }
    setTokenCache({ token: freshToken.token, region: freshToken.region });

    // Pause any playing narration before recording.
    const audioEl = audio.audioRef.current;
    if (audioEl && !audioEl.paused) {
      stopRange({ pause: true });
    }

    setPhase("recording");
    setResult(null);
    setSavedNote("idle");
    setIsNewBest(false);
    recordedRef.current = false;

    // Start Web Audio level meter (separate getUserMedia — mic permission already
    // granted, browser reuses the device without a second dialog).
    await startMeter();

    // Start countdown + auto-stop safety timer.
    startCountdown();
    autoStopTimerRef.current = setTimeout(() => {
      void stopRecording(true);
    }, MAX_RECORD_MS);

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
      void persistAttempt(assessment, currentSentence);
    } catch (err) {
      cancelAutoStop();
      stopMeter();
      const msg = err instanceof Error ? err.message : "Recognition failed";
      if (msg.includes("NotAllowedError") || msg.toLowerCase().includes("permission")) {
        setPhase("mic-denied");
      } else if (msg.includes("NotFoundError") || msg.toLowerCase().includes("no device")) {
        setPhase("no-device");
      } else {
        setPhase("error");
        setErrorMsg("Something went wrong scoring that. Check your connection and try again.");
      }
    }
  }

  async function stopRecording(andProcess: boolean) {
    cancelAutoStop();
    stopCountdown();
    stopMeter();
    if (!andProcess) {
      recognizerRef.current?.close();
      recognizerRef.current = null;
      setPhase("idle");
      return;
    }
    // Allow the SDK's recognizeOnceAsync to resolve naturally after closing.
    recognizerRef.current?.close();
  }

  /**
   * Dynamically imports the Speech SDK (browser-only, never runs during SSR)
   * and runs pronunciation assessment for the given sentence.
   */
  async function runPronunciationAssessment(
    token: string,
    region: string,
    referenceText: string,
  ): Promise<AssessResult> {
    // Dynamic import — the only place the SDK is loaded at runtime.
    const sdk = await import("microsoft-cognitiveservices-speech-sdk");

    const speechConfig = sdk.SpeechConfig.fromAuthorizationToken(token, region);
    speechConfig.speechRecognitionLanguage = "en-US";

    const audioConfig = sdk.AudioConfig.fromDefaultMicrophoneInput();

    const pronConfig = new sdk.PronunciationAssessmentConfig(
      referenceText,
      sdk.PronunciationAssessmentGradingSystem.HundredMark,
      sdk.PronunciationAssessmentGranularity.Word,
      true, // enableMiscue
    );

    const recognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig);
    pronConfig.applyTo(recognizer);

    // Store for manual Stop.
    recognizerRef.current = recognizer;

    return new Promise<AssessResult>((resolve, reject) => {
      recognizer.recognizeOnceAsync(
        (speechResult: SpeechRecognitionResult) => {
          recognizerRef.current = null;
          try {
            recognizer.close();
          } catch { /* ignore close errors */ }

          const assessment = sdk.PronunciationAssessmentResult.fromResult(speechResult);
          if (!assessment) {
            reject(new Error("No assessment data in result"));
            return;
          }

          const detailWords = assessment.detailResult?.Words ?? [];
          const wordResults: WordResult[] = detailWords.map(
            // SDK's WordResult type is not exported; use unknown cast.
            (w: unknown) => {
              const wd = w as {
                Word: string;
                PronunciationAssessment?: { AccuracyScore: number; ErrorType: string };
              };
              const score = wd.PronunciationAssessment?.AccuracyScore ?? 100;
              const errorType = wd.PronunciationAssessment?.ErrorType ?? "None";
              return {
                word: wd.Word,
                score: Math.round(score),
                errorType,
                band: getWordBand(score, errorType),
              };
            },
          );

          resolve({
            accuracyScore: Math.round(assessment.accuracyScore),
            fluencyScore: Math.round(assessment.fluencyScore),
            completenessScore: Math.round(assessment.completenessScore),
            pronScore: Math.round(assessment.pronunciationScore),
            words: wordResults,
          });
        },
        (err: string | Error) => {
          recognizerRef.current = null;
          try { recognizer.close(); } catch { /* ignore */ }
          const msg = typeof err === "string" ? err : (err?.message ?? "Recognition failed");
          reject(new Error(msg));
        },
      );
    });
  }

  async function persistAttempt(a: AssessResult, refText: string) {
    if (recordedRef.current) return;
    recordedRef.current = true;
    setSavedNote("saving");

    // Capture prior best for "New best!" detection.
    const priorBest = sentenceHistory.best;

    try {
      const res = await fetch("/api/pronunciation/attempt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          referenceText: refText,
          accuracyScore: a.accuracyScore,
          fluencyScore: a.fluencyScore,
          completenessScore: a.completenessScore,
          pronScore: a.pronScore,
          articleId,
        }),
      });
      if (!res.ok) throw new Error("save failed");

      const data = (await res.json()) as { attempt: { referenceText: string; pronScore: number; createdAt: string } };
      setSavedNote("saved");

      // Prepend new attempt to local history for instant per-sentence update.
      setAllAttempts((prev) => [data.attempt, ...prev]);

      // "New best!" detection.
      if (priorBest === null || a.pronScore > priorBest) {
        setIsNewBest(true);
      }
    } catch {
      setSavedNote("failed");
    }
  }

  // ─── "Hear it" ────────────────────────────────────────────────────────────

  async function handleHearIt() {
    // Prevent "Hear it" during recording.
    if (phase === "recording") return;

    if (!audio.isLoaded && !audio.isFallback) {
      // Warm narration lazily.
      await audio.warmNarration(articleId);
    }

    if (audio.isFallback) return; // narration unavailable

    const audioEl = audio.audioRef.current;
    if (!audioEl) return;

    const range = findSpeechSentenceRange(currentSentence, plainText, audio.words);
    if (!range) return;

    playRange(range);
  }

  // ─── Level meter ──────────────────────────────────────────────────────────

  async function startMeter() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      meterStreamRef.current = stream;
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;
      const buf = new Uint8Array(analyser.frequencyBinCount);

      function tick() {
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) {
          const n = (v - 128) / 128;
          sum += n * n;
        }
        const rms = Math.sqrt(sum / buf.length);
        setMeterLevel(Math.min(1, rms * 5));
        meterAnimRef.current = requestAnimationFrame(tick);
      }
      meterAnimRef.current = requestAnimationFrame(tick);
    } catch {
      // Meter unavailable — degrade gracefully (just no meter visuals).
    }
  }

  function stopMeter() {
    if (meterAnimRef.current !== null) {
      cancelAnimationFrame(meterAnimRef.current);
      meterAnimRef.current = null;
    }
    audioCtxRef.current?.close().catch(() => {/* ignore */});
    audioCtxRef.current = null;
    analyserRef.current = null;
    meterStreamRef.current?.getTracks().forEach((t) => t.stop());
    meterStreamRef.current = null;
    setMeterLevel(0);
  }

  // ─── Countdown ────────────────────────────────────────────────────────────

  function startCountdown() {
    recordingStartRef.current = Date.now();
    countdownIntervalRef.current = setInterval(() => {
      const elapsed = Date.now() - recordingStartRef.current;
      const remaining = Math.ceil((MAX_RECORD_MS - elapsed) / 1000);
      if (remaining <= COUNTDOWN_START_S) {
        setSecondsRemaining(Math.max(0, remaining));
      }
      if (remaining <= 0) stopCountdown();
    }, 500);
  }

  function stopCountdown() {
    if (countdownIntervalRef.current !== null) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
    setSecondsRemaining(null);
  }

  function cancelAutoStop() {
    if (autoStopTimerRef.current !== null) {
      clearTimeout(autoStopTimerRef.current);
      autoStopTimerRef.current = null;
    }
    stopCountdown();
  }

  // ─── Sentence navigation ──────────────────────────────────────────────────

  function goPrev() {
    if (currentIndex > 0) setCurrentIndex((i) => i - 1);
  }
  function goNext() {
    if (currentIndex < sentenceCount - 1) setCurrentIndex((i) => i + 1);
  }

  // ─── Record-again ─────────────────────────────────────────────────────────

  function handleRecordAgain() {
    setResult(null);
    setPhase("idle");
    setSavedNote("idle");
    setIsNewBest(false);
    recordedRef.current = false;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  // ── "Hear it" button ──────────────────────────────────────────────────────
  const hearItDisabled =
    phase === "recording" || phase === "processing" ||
    (audio.isLoaded && audio.isFallback);
  const hearItTitle = audio.isLoaded && audio.isFallback
    ? "Model audio isn't available right now."
    : undefined;

  // ── No sentences guard ────────────────────────────────────────────────────
  if (sentenceCount === 0) {
    return (
      <EmptyState
        icon={MicOff}
        title="No practisable sentences"
        description="This article doesn't contain sentences suitable for pronunciation practice."
      />
    );
  }

  // ── Loading token ─────────────────────────────────────────────────────────
  if (phase === "init") {
    return <p className="muted" aria-live="polite">Loading pronunciation tools…</p>;
  }

  // ── Unconfigured ──────────────────────────────────────────────────────────
  if (phase === "unavailable") {
    return (
      <div className="rw-speak-panel">
        <EmptyState
          icon={MicOff}
          title="Pronunciation practice isn't available"
          description="This reader's speech service isn't set up right now, so we can't score your reading. You can still listen to the model pronunciation and use the other tools."
        />
        {/* "Hear it" even when scoring is unavailable */}
        {!audio.isFallback && (
          <Button
            variant="ghost"
            size="sm"
            leadingIcon={<Volume2 size={14} aria-hidden />}
            onClick={() => void handleHearIt()}
            loading={audio.isWarming}
            aria-disabled={hearItDisabled || undefined}
            title={hearItTitle}
          >
            Hear this sentence
          </Button>
        )}
      </div>
    );
  }

  // ── Reference sentence card (shared across phases) ────────────────────────
  const sentenceCard =
    phase === "result" && result ? (
      <>
        <WordDisplay sentence={currentSentence} wordResults={result.words} />
        <PronLegend />
      </>
    ) : (
      <p className="rw-speak-sentence-card" lang="en">
        {currentSentence}
      </p>
    );

  return (
    <div className="rw-speak-panel">
      <div style={{ marginBottom: "var(--space-3)" }}>
        <AiBadge />
      </div>
      {/* ── Sentence stepper ─────────────────────────────────────────── */}
      <div className="rw-speak-stepper">
        <button
          type="button"
          className={cn("rw-speak-stepper-btn", focusRing)}
          onClick={goPrev}
          disabled={currentIndex === 0}
          aria-label="Previous sentence"
        >
          <ChevronLeft size={16} aria-hidden />
        </button>

        <span
          className="rw-speak-stepper-counter"
          aria-live="polite"
          aria-atomic="true"
        >
          {currentIndex + 1} of {sentenceCount}
        </span>

        <button
          type="button"
          className={cn("rw-speak-stepper-btn", focusRing)}
          onClick={goNext}
          disabled={currentIndex === sentenceCount - 1}
          aria-label="Next sentence"
        >
          <ChevronRight size={16} aria-hidden />
        </button>
      </div>

      {/* ── Reference sentence ────────────────────────────────────────── */}
      {sentenceCard}

      {/* ── Result block ─────────────────────────────────────────────── */}
      {phase === "result" && result ? (
        <div
          role="status"
          aria-live="polite"
          aria-label={`Pronunciation score: ${result.pronScore} out of 100.`}
          className="rw-speak-result rw-fade-up"
        >
          <ScoreRing score={result.pronScore} />
          <SubBars
            accuracy={result.accuracyScore}
            fluency={result.fluencyScore}
            completeness={result.completenessScore}
          />
          <WordsToWorkOn wordResults={result.words} />

          {/* Per-sentence best / last */}
          {(sentenceHistory.best !== null || isNewBest) && (
            <div className={cn("rw-speak-history-line", isNewBest && "rw-speak-new-best")}>
              <span className="rw-speak-best-badge">
                <Star size={12} aria-hidden />
                Best {sentenceHistory.best ?? result.pronScore}
              </span>
              {sentenceHistory.last !== null && (
                <span>· Last {sentenceHistory.last}</span>
              )}
              {isNewBest && (
                <Badge variant="success">New best! 🎉</Badge>
              )}
            </div>
          )}

          {/* Saved note */}
          <p className="rw-speak-saved-note" aria-live="polite">
            {savedNote === "saving" ? (
              "Saving…"
            ) : savedNote === "saved" ? (
              <>
                <Check size={12} aria-hidden />
                {" "}Attempt saved
              </>
            ) : savedNote === "failed" ? (
              "Couldn't save this attempt"
            ) : null}
          </p>

          {/* Record again */}
          <Button
            variant="outline"
            size="sm"
            leadingIcon={<RotateCcw size={14} aria-hidden />}
            onClick={handleRecordAgain}
          >
            Record again
          </Button>
        </div>
      ) : null}

      {/* ── Recording state ───────────────────────────────────────────── */}
      {phase === "recording" ? (
        <div className="rw-speak-result">
          {/* Live region: announces recording started/stopped */}
          <div
            role="status"
            aria-live="assertive"
            className="rw-speak-recording-status"
          >
            {/* Pulsing red dot */}
            <span className="rw-speak-pulse-wrap" aria-hidden>
              <span className="rw-speak-pulse-dot" />
              <span className="rw-speak-pulse-ring rw-speak-pulse-ring" />
            </span>
            <span>Recording…</span>
            {secondsRemaining !== null && (
              <span className="rw-speak-countdown" aria-live="off">
                {secondsRemaining}s
              </span>
            )}
          </div>

          {/* Mic level meter (informative, aria-hidden) */}
          <div className="rw-speak-meter" aria-hidden="true">
            {Array.from({ length: 7 }, (_, i) => (
              <div
                key={i}
                className={cn(
                  "rw-speak-meter-seg",
                  meterLevel > (i + 0.5) / 7 && "is-active",
                )}
              />
            ))}
          </div>
        </div>
      ) : null}

      {/* ── Processing state ──────────────────────────────────────────── */}
      {phase === "processing" ? (
        <p className="muted" aria-live="polite">
          Analysing your pronunciation…
        </p>
      ) : null}

      {/* ── Mic-denied state ──────────────────────────────────────────── */}
      {phase === "mic-denied" ? (
        <div className="rw-speak-note" role="alert">
          <MicOff size={16} className="rw-speak-note-icon" aria-hidden />
          <div className="rw-speak-note-body">
            <p className="rw-speak-note-title">Microphone access denied</p>
            <p className="rw-speak-note-copy">
              ReadWise can&apos;t hear your microphone. To practice speaking, allow
              microphone access for this site in your browser&apos;s address-bar settings
              (the lock icon → Microphone → Allow), then try again.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setPhase("idle");
                setErrorMsg(null);
              }}
            >
              Try again
            </Button>
          </div>
        </div>
      ) : null}

      {/* ── No-device state ───────────────────────────────────────────── */}
      {phase === "no-device" ? (
        <div className="rw-speak-note" role="alert">
          <MicOff size={16} className="rw-speak-note-icon" aria-hidden />
          <div className="rw-speak-note-body">
            <p className="rw-speak-note-title">No microphone found</p>
            <p className="rw-speak-note-copy">
              No microphone was detected. Connect one and try again.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setPhase("idle");
                setErrorMsg(null);
              }}
            >
              Try again
            </Button>
          </div>
        </div>
      ) : null}

      {/* ── Network / SDK error ───────────────────────────────────────── */}
      {phase === "error" ? (
        <div className="rw-speak-note" role="alert">
          <AlertTriangle size={16} className="rw-speak-note-icon" aria-hidden />
          <div className="rw-speak-note-body">
            <p className="rw-speak-note-title">Something went wrong</p>
            <p className="rw-speak-note-copy">
              {errorMsg ?? "Something went wrong scoring that. Check your connection and try again."}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                setPhase("idle");
                setErrorMsg(null);
                // Re-fetch a fresh token on retry.
                const t = await fetchToken();
                if (t.status === "ok") setTokenCache({ token: t.token, region: t.region });
              }}
            >
              Retry
            </Button>
          </div>
        </div>
      ) : null}

      {/* ── Controls (Record + Hear it) ───────────────────────────────── */}
      {(phase === "idle" || phase === "recording") && (
        <div className="rw-speak-controls">
          {phase === "idle" ? (
            <Button
              variant="primary"
              size="md"
              className="rw-speak-record-btn"
              leadingIcon={<Mic size={16} aria-hidden />}
              onClick={() => void handleRecord()}
              aria-label="Tap to record"
              aria-pressed={false}
            >
              <span className="sm:hidden">Tap to record</span>
              <span className="hidden sm:inline">Record</span>
            </Button>
          ) : (
            <Button
              variant="danger"
              size="md"
              className="rw-speak-record-btn"
              leadingIcon={<Square size={16} aria-hidden />}
              onClick={() => void stopRecording(true)}
              aria-label="Stop recording"
              aria-pressed={true}
            >
              Stop
            </Button>
          )}

          <Button
            variant="ghost"
            size="md"
            leadingIcon={<Volume2 size={14} aria-hidden />}
            onClick={() => void handleHearIt()}
            loading={audio.isWarming}
            disabled={hearItDisabled}
            title={hearItTitle}
            aria-label="Hear this sentence"
          >
            Hear it
          </Button>
        </div>
      )}

      {/* ── Record-again controls ─────────────────────────────────────── */}
      {phase === "result" && (
        <div className="rw-speak-controls">
          <Button
            variant="ghost"
            size="sm"
            leadingIcon={<Volume2 size={14} aria-hidden />}
            onClick={() => void handleHearIt()}
            loading={audio.isWarming}
            disabled={hearItDisabled}
            title={hearItTitle}
            aria-label="Hear this sentence"
          >
            Hear it
          </Button>
        </div>
      )}

      {/* ── Privacy notice ────────────────────────────────────────────── */}
      {(phase === "idle" || phase === "mic-denied" || phase === "no-device" || phase === "error") && (
        <p className="rw-speak-privacy">
          Your recording is streamed securely to Azure for scoring and is never
          stored by ReadWise — only the numeric scores are saved.
        </p>
      )}

      {/* ── Per-sentence history (idle) ───────────────────────────────── */}
      {phase === "idle" && (sentenceHistory.best !== null) && (
        <div className="rw-speak-history-line">
          <span className="rw-speak-best-badge">
            <Star size={12} aria-hidden />
            Best {sentenceHistory.best}
          </span>
          {sentenceHistory.last !== null && (
            <span>· Last {sentenceHistory.last}</span>
          )}
        </div>
      )}
    </div>
  );
}
