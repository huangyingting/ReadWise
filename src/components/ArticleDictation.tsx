"use client";

/**
 * ArticleDictation (Issue #40 — Listening & Dictation Exercise)
 *
 * Listens to a single sentence from the article narration, then asks the
 * learner to type what they heard and grades the result.
 *
 * Flow:
 *   loading (warm narration) → idle → playing sentence → graded
 *
 * Requires:
 *   - ReaderAudioProvider (via useReaderAudio) to be mounted in the tree.
 *   - `plainText` prop — the same htmlToPlainText(content) that was used to
 *     generate the narration (so word offsets line up).
 *
 * Props:
 *   articleId  — used to lazily warm narration if the Listen tab hasn't been
 *                opened yet.
 *   plainText  — article body as plain text.
 *   active     — true when this panel is the visible tab.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import { ChevronLeft, ChevronRight, Headphones, RotateCcw } from "lucide-react";
import { cn, focusRing } from "@/lib/cn";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Textarea";
import EmptyState from "@/components/EmptyState";
import AiBadge from "@/components/AiBadge";
import { useReaderAudio } from "@/components/ReaderAudioProvider";
import { useAudioRangePlayback } from "@/components/reader/useAudioRangePlayback";
import {
  segmentDictation,
  gradeDictation,
  type DictationSegment,
  type DiffToken,
} from "@/lib/dictation";

// ─── Types ────────────────────────────────────────────────────────────────────

type Phase =
  | "warming"    // narration fetch in progress
  | "idle"       // narration loaded, waiting for user to play a sentence
  | "playing"    // sentence audio playing
  | "typed"      // user has typed something, not yet graded
  | "graded"     // result shown
  | "fallback"   // narration unavailable
  | "error";     // network / other error

// ─── Component ────────────────────────────────────────────────────────────────

export default function ArticleDictation({
  articleId,
  plainText,
  active,
}: {
  articleId: string;
  plainText: string;
  active: boolean;
}) {
  const audio = useReaderAudio();

  const [phase, setPhase] = useState<Phase>("warming");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [segments, setSegments] = useState<DictationSegment[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [typed, setTyped] = useState("");
  const [grade, setGrade] = useState<ReturnType<typeof gradeDictation> | null>(null);

  const warmStartedRef = useRef(false);
  const { playRange, stopRange } = useAudioRangePlayback(audio.audioRef);

  // Stop sentence playback when the tab becomes hidden or the overlay closes
  // (`active` is `open && activeTab === "dictate"`) (#210).
  useEffect(() => {
    if (active) return;
    stopRange({ pause: true });
    setPhase((p) => (p === "playing" ? "idle" : p));
  }, [active, stopRange]);

  // When audio is already loaded (Listen tab was visited), compute segments.
  useEffect(() => {
    if (audio.isLoaded && !audio.isFallback && audio.words.length > 0 && segments.length === 0) {
      const segs = segmentDictation(audio.plainText || plainText, audio.words);
      setSegments(segs);
      setPhase(segs.length > 0 ? "idle" : "fallback");
    } else if (audio.isFallback && phase === "warming") {
      setPhase("fallback");
    } else if (audio.warmError && phase === "warming") {
      setErrorMsg(audio.warmError);
      setPhase("error");
    }
  }, [audio.isLoaded, audio.isFallback, audio.words, audio.plainText, audio.warmError, plainText, segments.length, phase]);

  // Warm narration lazily on first render if not already loaded.
  useEffect(() => {
    if (warmStartedRef.current || audio.isLoaded) return;
    warmStartedRef.current = true;
    void audio.warmNarration(articleId);
  }, [articleId, audio]);

  const currentSegment = segments[currentIdx] ?? null;

  function handlePlay() {
    if (!currentSegment) return;
    const started = playRange(currentSegment, {
      onEnd: () => setPhase((p) => (p === "playing" ? "idle" : p)),
    });
    if (started) setPhase("playing");
  }

  function handleStop() {
    stopRange({ pause: true });
    setPhase("idle");
  }

  function handleTyped(e: ChangeEvent<HTMLTextAreaElement>) {
    setTyped(e.target.value);
    if (grade) setGrade(null);
    setPhase("typed");
  }

  function handleCheck(e: FormEvent) {
    e.preventDefault();
    if (!currentSegment || !typed.trim()) return;
    stopRange({ pause: true });
    setGrade(gradeDictation(currentSegment.text, typed));
    setPhase("graded");
  }

  function handleReset() {
    stopRange({ pause: true });
    setTyped("");
    setGrade(null);
    setPhase("idle");
  }

  const handlePrev = useCallback(() => {
    handleReset();
    setCurrentIdx((i) => Math.max(0, i - 1));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleNext = useCallback(() => {
    handleReset();
    setCurrentIdx((i) => Math.min(segments.length - 1, i + 1));
  }, [segments.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Render ─────────────────────────────────────────────────────────────────

  if (phase === "warming") {
    return <p className="muted">Loading narration…</p>;
  }

  if (phase === "fallback") {
    return (
      <EmptyState
        icon={Headphones}
        title="Narration not available"
        description="Audio for this article isn't ready yet. Check back in a few minutes."
      />
    );
  }

  if (phase === "error") {
    return (
      <p className="tts-error" role="alert">
        {errorMsg ?? "Could not load narration."}
      </p>
    );
  }

  if (segments.length === 0) {
    return <p className="muted">No practisable sentences found in this article.</p>;
  }

  return (
    <div className="rw-dictate-panel">
      {/* ── AI badge ── */}
      <div style={{ marginBottom: "var(--space-3)" }}>
        <AiBadge />
      </div>

      {/* ── Sentence navigator ── */}
      <div className="rw-dictate-stepper" role="navigation" aria-label="Sentence navigation">
        <button
          type="button"
          className={cn("rw-dictate-stepper-btn", focusRing)}
          onClick={handlePrev}
          disabled={currentIdx === 0}
          aria-label="Previous sentence"
        >
          <ChevronLeft size={16} aria-hidden />
        </button>
        <span className="rw-dictate-stepper-counter" aria-live="polite">
          {currentIdx + 1} / {segments.length}
        </span>
        <button
          type="button"
          className={cn("rw-dictate-stepper-btn", focusRing)}
          onClick={handleNext}
          disabled={currentIdx === segments.length - 1}
          aria-label="Next sentence"
        >
          <ChevronRight size={16} aria-hidden />
        </button>
      </div>

      {/* ── Play / stop ── */}
      <div className="rw-dictate-controls">
        {phase !== "playing" ? (
          <Button
            variant="primary"
            size="sm"
            onClick={handlePlay}
            aria-label="Play sentence"
          >
            <Headphones size={14} aria-hidden />
            Play sentence
          </Button>
        ) : (
          <Button variant="outline" size="sm" onClick={handleStop} aria-label="Stop playback">
            Stop
          </Button>
        )}
      </div>

      {/* ── Input form ── */}
      <form onSubmit={handleCheck} className="rw-dictate-form">
        <label htmlFor="dictation-input" className="rw-dictate-label">
          Type what you heard:
        </label>
        <Textarea
          id="dictation-input"
          className={cn("rw-dictate-textarea", focusRing)}
          value={typed}
          onChange={handleTyped}
          placeholder="Type the sentence here…"
          rows={3}
          lang="en"
          spellCheck={false}
          autoComplete="off"
          aria-label="Your dictation"
          disabled={phase === "playing"}
        />
        <div className="rw-dictate-form-row">
          <Button
            type="submit"
            variant="primary"
            size="sm"
            disabled={!typed.trim() || phase === "playing"}
          >
            Check
          </Button>
          {(phase === "typed" || phase === "graded") && (
            <button
              type="button"
              className={cn("rw-dictate-reset-btn", focusRing)}
              onClick={handleReset}
              aria-label="Try again"
            >
              <RotateCcw size={13} aria-hidden />
              Try again
            </button>
          )}
        </div>
      </form>

      {/* ── Grading result ── */}
      {phase === "graded" && grade && currentSegment && (
        <div className="rw-dictate-result" role="region" aria-label="Dictation result">
          <ScoreBar accuracy={grade.accuracy} />
          <DiffDisplay tokens={grade.tokens} reference={currentSegment.text} />
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ScoreBar({ accuracy }: { accuracy: number }) {
  const variant =
    accuracy >= 90 ? "good" : accuracy >= 70 ? "fair" : accuracy >= 50 ? "poor" : "bad";

  return (
    <div className="rw-dictate-score">
      <div
        role="meter"
        aria-label={`Accuracy: ${accuracy}%`}
        aria-valuenow={accuracy}
        aria-valuemin={0}
        aria-valuemax={100}
        className="rw-dictate-score-track"
      >
        <div
          className={cn("rw-dictate-score-fill", `rw-dictate-score-fill--${variant}`)}
          style={{ width: `${accuracy}%` }}
        />
      </div>
      <span className="rw-dictate-score-label" aria-hidden>
        {accuracy}%
      </span>
    </div>
  );
}

function DiffDisplay({ tokens, reference }: { tokens: DiffToken[]; reference: string }) {
  return (
    <div className="rw-dictate-diff" aria-label="Word-level feedback" lang="en">
      <p className="rw-dictate-diff-hint muted">
        Reference: <em>{reference}</em>
      </p>
      <p className="rw-dictate-diff-tokens" aria-live="polite">
        {tokens.map((tok, i) => {
          if (tok.status === "correct") {
            return (
              <span key={i} className="rw-dictate-word rw-dictate-word--correct" title="Correct">
                {tok.word}
              </span>
            );
          }
          if (tok.status === "wrong") {
            return (
              <span
                key={i}
                className="rw-dictate-word rw-dictate-word--wrong"
                title={`You typed: "${tok.typed}"`}
                aria-label={`"${tok.typed}" should be "${tok.word}"`}
              >
                {tok.typed}
                <span className="rw-dictate-correction" aria-hidden> → {tok.word}</span>
              </span>
            );
          }
          if (tok.status === "missing") {
            return (
              <span
                key={i}
                className="rw-dictate-word rw-dictate-word--missing"
                title="Missed word"
                aria-label={`Missed word: "${tok.word}"`}
              >
                {tok.word}
              </span>
            );
          }
          // extra
          return (
            <span
              key={i}
              className="rw-dictate-word rw-dictate-word--extra"
              title="Extra word not in original"
              aria-label={`Extra word: "${tok.word}"`}
            >
              {tok.word}
            </span>
          );
        })}
      </p>
    </div>
  );
}
