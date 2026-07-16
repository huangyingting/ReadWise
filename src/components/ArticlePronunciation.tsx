"use client";

/**
 * ArticlePronunciation (M16) — feature orchestrator
 *
 * "Speak" tab panel — browser-side pronunciation assessment via the Azure
 * Speech SDK. Never imports the SDK at module level (SSR-safe); the SDK is
 * loaded dynamically inside usePronunciationAssessment.
 *
 * Responsibilities of this component (thin orchestrator):
 *   - Render layout from extracted presentational components
 *   - Manage shared audio/TTS playback ("Hear it")
 *   - Clean up range playback on unmount / tab hidden
 *
 * State machine, recording lifecycle, persistence, and sentence navigation
 * live in usePronunciationSession.
 *
 * Props:
 *   articleId      — for API calls and attempt persistence
 *   plainText      — article body as plain text; used to split sentences and
 *                    match TTS word timings for "Hear it"
 *   active         — true when the Speak tab is the currently visible panel
 *   currentBlockText — #377: text of the prose block the user is currently
 *                    reading; when provided the panel defaults to the first
 *                    sentence belonging to that paragraph on first activation
 */

import { useEffect, useMemo } from "react";
import { Mic, MicOff, RotateCcw, Square, Star, Volume2 } from "lucide-react";
import { EmptyState, Tooltip } from "@/components/ui";
import AiBadge from "@/components/AiBadge";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { useReaderAudio } from "@/components/ReaderAudioProvider";
import { useAudioRangePlayback } from "@/components/reader/useAudioRangePlayback";
import { usePronunciationSession } from "@/components/pronunciation/usePronunciationSession";
import { SentenceStepper } from "@/components/pronunciation/SentenceStepper";
import { SentenceCard } from "@/components/pronunciation/SentenceCard";
import { RecordingPanel } from "@/components/pronunciation/RecordingPanel";
import { PronunciationResult } from "@/components/pronunciation/PronunciationResult";
import { ErrorNotice } from "@/components/pronunciation/ErrorNotice";
import {
  findSpeechSentenceRange,
  splitPracticeSentences,
} from "@/lib/speech/practice";

type ArticlePronunciationProps = {
  articleId: string;
  plainText: string;
  active: boolean;
  /** #377: text of the prose block the user is currently reading. When
   *  provided and the panel is in idle state, the component defaults to the
   *  first sentence belonging to that paragraph. */
  currentBlockText?: string;
};

type HearItButtonProps = {
  label: string;
  size: "sm" | "md";
  onClick: () => void;
  loading: boolean;
  disabled?: boolean;
  title?: string;
  ariaDisabled?: boolean;
};

type ErrorPhase = "mic-denied" | "no-device" | "error";

function isErrorPhase(phase: string): phase is ErrorPhase {
  return phase === "mic-denied" || phase === "no-device" || phase === "error";
}

function showsPrivacyNotice(phase: string) {
  return (
    phase === "idle" ||
    phase === "mic-denied" ||
    phase === "no-device" ||
    phase === "error"
  );
}

function HearItButton({
  label,
  size,
  onClick,
  loading,
  disabled,
  title,
  ariaDisabled,
}: HearItButtonProps) {
  const button = (
    <Button
      variant="ghost"
      size={size}
      leadingIcon={<Volume2 size={14} aria-hidden />}
      onClick={onClick}
      loading={loading}
      disabled={disabled}
      aria-disabled={ariaDisabled || undefined}
      aria-label="Hear this sentence"
    >
      {label}
    </Button>
  );

  return title ? <Tooltip content={title}>{button}</Tooltip> : button;
}

function WeakSentenceResurface({
  weakSentences,
  currentIndex,
  onPractice,
}: {
  weakSentences: Array<{
    index: number;
    referenceText: string;
    latestScore: number;
    trendDelta: number;
    attempts: number;
  }>;
  currentIndex: number;
  onPractice: (index: number) => void;
}) {
  const candidates = weakSentences.filter((item) => item.index !== currentIndex);
  if (candidates.length === 0) return null;

  return (
    <section aria-label="Sentences to practise again" className="flex flex-col gap-[var(--space-2)]">
      <p className="text-[length:var(--text-sm)] font-medium text-text m-0">
        Practise these again
      </p>
      <ul className="list-none p-0 m-0 flex flex-col gap-[var(--space-2)]">
        {candidates.slice(0, 3).map((item) => (
          <li
            key={`${item.index}:${item.referenceText}`}
            className="rounded-[var(--radius-md)] border border-border p-[var(--space-3)]"
          >
            <div className="flex flex-col gap-[var(--space-2)] sm:flex-row sm:items-center sm:justify-between">
              <p className="text-[length:var(--text-sm)] text-text-muted m-0 line-clamp-2">
                {item.referenceText}
              </p>
              <Button
                variant="outline"
                size="sm"
                leadingIcon={<RotateCcw size={14} aria-hidden />}
                onClick={() => onPractice(item.index)}
              >
                Practise
              </Button>
            </div>
            <p className="text-[length:var(--text-xs)] text-text-muted m-0 mt-[var(--space-1)]">
              Latest {item.latestScore}% · {item.attempts} attempt{item.attempts === 1 ? "" : "s"}
              {item.trendDelta === 0 ? " · steady" : ` · ${item.trendDelta > 0 ? "+" : ""}${item.trendDelta} trend`}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function ArticlePronunciation({
  articleId,
  plainText,
  active,
  currentBlockText,
}: ArticlePronunciationProps) {
  const audio = useReaderAudio();
  const sentences = useMemo(() => splitPracticeSentences(plainText), [plainText]);
  const { playRange, stopRange } = useAudioRangePlayback(audio.audioRef);

  const session = usePronunciationSession({
    active,
    articleId,
    sentences,
    currentBlockText,
    // Pause model narration right before the microphone opens.
    stopPlayback: () => {
      const audioEl = audio.audioRef.current;
      if (audioEl && !audioEl.paused) stopRange({ pause: true });
    },
  });

  // ── Range playback cleanup ────────────────────────────────────────────────
  useEffect(() => {
    return () => { stopRange(); };
  }, [stopRange]);

  // Stop playback when the Speak tab becomes hidden or the overlay closes.
  useEffect(() => {
    if (active) return;
    stopRange({ pause: true });
  }, [active, stopRange]);

  // ─── "Hear it" ────────────────────────────────────────────────────────────

  async function handleHearIt() {
    if (session.phase === "recording") return;

    if (!audio.isLoaded && !audio.isFallback) {
      await audio.warmNarration(articleId);
    }
    if (audio.isFallback) return;

    const audioEl = audio.audioRef.current;
    if (!audioEl) return;

    const range = findSpeechSentenceRange(
      session.currentSentence,
      plainText,
      audio.words,
    );
    if (!range) return;

    playRange(range);
  }

  const hearItDisabled =
    session.phase === "recording" ||
    session.phase === "processing" ||
    (audio.isLoaded && audio.isFallback);
  const hearItTitle =
    audio.isLoaded && audio.isFallback
      ? "Model audio isn't available right now."
      : undefined;

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  const phase = session.phase;
  const isIdle = phase === "idle";
  const isRecording = phase === "recording";
  const isResult = phase === "result";

  if (session.sentenceCount === 0) {
    return (
      <EmptyState
        icon={MicOff}
        title="No practisable sentences"
        description="This article doesn't contain sentences suitable for pronunciation practice."
      />
    );
  }

  if (phase === "init") {
    return (
      <p className="muted" aria-live="polite">
        <Spinner size="sm" className="text-text-subtle" label="Loading pronunciation tools…" />
      </p>
    );
  }

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
          <HearItButton
            label="Hear this sentence"
            size="sm"
            onClick={() => void handleHearIt()}
            loading={audio.isWarming}
            ariaDisabled={hearItDisabled}
            title={hearItTitle}
          />
        )}
      </div>
    );
  }

  return (
    <div className="rw-speak-panel">
      <div className="mb-[var(--space-3)]">
        <AiBadge />
      </div>

      {/* ── Sentence stepper ─────────────────────────────────────────── */}
      <SentenceStepper
        currentIndex={session.currentIndex}
        sentenceCount={session.sentenceCount}
        onPrev={session.goPrev}
        onNext={session.goNext}
      />

      {/* ── Reference sentence (with word-band highlight in result phase) */}
      <SentenceCard
       sentence={session.currentSentence}
       wordResults={isResult && session.result ? session.result.words : null}
      />

      {/* ── Result block ─────────────────────────────────────────────── */}
      {isResult && session.result ? (
       <PronunciationResult
         result={session.result}
         sentenceHistory={session.sentenceHistory}
          savedNote={session.savedNote}
          isNewBest={session.isNewBest}
          onRecordAgain={session.handleRecordAgain}
        />
      ) : null}

      <WeakSentenceResurface
        weakSentences={session.weakSentences}
        currentIndex={session.currentIndex}
        onPractice={session.practiceWeakSentence}
      />

      {/* ── Recording state ───────────────────────────────────────────── */}
      {isRecording ? (
        <RecordingPanel
          meterLevel={session.meterLevel}
          secondsRemaining={session.secondsRemaining}
        />
      ) : null}

      {/* ── Processing state ──────────────────────────────────────────── */}
      {phase === "processing" ? (
        <p className="muted" aria-live="polite">
          Analysing your pronunciation…
        </p>
      ) : null}

      {/* ── Error states (mic-denied / no-device / network error) ─────── */}
      {isErrorPhase(phase) ? (
        <ErrorNotice
          type={phase}
          errorMsg={session.errorMsg}
          onRetry={
            phase === "error"
              ? () => void session.handleRetry()
              : phase === "mic-denied"
                ? session.handleMicDeniedRetry
                : session.handleNoDeviceRetry
          }
        />
      ) : null}

      {/* ── Controls (Record + Hear it) ───────────────────────────────── */}
      {(isIdle || isRecording) && (
        <div className="rw-speak-controls">
          {isIdle ? (
            <Button
              variant="primary"
              size="md"
              className="rw-speak-record-btn"
              leadingIcon={<Mic size={16} aria-hidden />}
              onClick={() => void session.handleRecord()}
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
              onClick={() => void session.handleStop()}
              aria-label="Stop recording"
              aria-pressed={true}
            >
              Stop
            </Button>
          )}

          <HearItButton
            label="Hear it"
            size="md"
            onClick={() => void handleHearIt()}
            loading={audio.isWarming}
            disabled={hearItDisabled}
            title={hearItTitle}
          />
        </div>
      )}

      {/* ── Record-again controls ─────────────────────────────────────── */}
      {isResult && (
        <div className="rw-speak-controls">
          <HearItButton
            label="Hear it"
            size="sm"
            onClick={() => void handleHearIt()}
            loading={audio.isWarming}
            disabled={hearItDisabled}
            title={hearItTitle}
          />
        </div>
      )}

      {/* ── Privacy notice ────────────────────────────────────────────── */}
      {showsPrivacyNotice(phase) && (
        <p className="rw-speak-privacy">
          Your recording is streamed securely to Azure for scoring and is never
          stored by ReadWise — only the numeric scores are saved.
        </p>
      )}

      {/* ── Per-sentence history (idle) ───────────────────────────────── */}
      {isIdle && session.sentenceHistory.best !== null && (
        <div className="rw-speak-history-line">
          <span className="rw-speak-best-badge">
            <Star size={12} aria-hidden />
            Best {session.sentenceHistory.best}
          </span>
          {session.sentenceHistory.last !== null && (
            <span>· Last {session.sentenceHistory.last}</span>
          )}
        </div>
      )}
    </div>
  );
}
