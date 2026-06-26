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
import { Mic, MicOff, Square, Star, Volume2 } from "lucide-react";
import EmptyState from "@/components/EmptyState";
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

  if (session.sentenceCount === 0) {
    return (
      <EmptyState
        icon={MicOff}
        title="No practisable sentences"
        description="This article doesn't contain sentences suitable for pronunciation practice."
      />
    );
  }

  if (session.phase === "init") {
    return (
      <p className="muted" aria-live="polite">
        <Spinner size="sm" className="text-text-subtle" label="Loading pronunciation tools…" />
      </p>
    );
  }

  if (session.phase === "unavailable") {
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

  return (
    <div className="rw-speak-panel">
      <div style={{ marginBottom: "var(--space-3)" }}>
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
        wordResults={
          session.phase === "result" && session.result
            ? session.result.words
            : null
        }
      />

      {/* ── Result block ─────────────────────────────────────────────── */}
      {session.phase === "result" && session.result ? (
        <PronunciationResult
          result={session.result}
          sentenceHistory={session.sentenceHistory}
          savedNote={session.savedNote}
          isNewBest={session.isNewBest}
          onRecordAgain={session.handleRecordAgain}
        />
      ) : null}

      {/* ── Recording state ───────────────────────────────────────────── */}
      {session.phase === "recording" ? (
        <RecordingPanel
          meterLevel={session.meterLevel}
          secondsRemaining={session.secondsRemaining}
        />
      ) : null}

      {/* ── Processing state ──────────────────────────────────────────── */}
      {session.phase === "processing" ? (
        <p className="muted" aria-live="polite">
          Analysing your pronunciation…
        </p>
      ) : null}

      {/* ── Error states (mic-denied / no-device / network error) ─────── */}
      {(session.phase === "mic-denied" ||
        session.phase === "no-device" ||
        session.phase === "error") ? (
        <ErrorNotice
          type={session.phase}
          errorMsg={session.errorMsg}
          onRetry={
            session.phase === "error"
              ? () => void session.handleRetry()
              : session.phase === "mic-denied"
                ? session.handleMicDeniedRetry
                : session.handleNoDeviceRetry
          }
        />
      ) : null}

      {/* ── Controls (Record + Hear it) ───────────────────────────────── */}
      {(session.phase === "idle" || session.phase === "recording") && (
        <div className="rw-speak-controls">
          {session.phase === "idle" ? (
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
      {session.phase === "result" && (
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
      {(session.phase === "idle" ||
        session.phase === "mic-denied" ||
        session.phase === "no-device" ||
        session.phase === "error") && (
        <p className="rw-speak-privacy">
          Your recording is streamed securely to Azure for scoring and is never
          stored by ReadWise — only the numeric scores are saved.
        </p>
      )}

      {/* ── Per-sentence history (idle) ───────────────────────────────── */}
      {session.phase === "idle" && session.sentenceHistory.best !== null && (
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
