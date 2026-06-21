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
import { useReaderAudio } from "@/components/ReaderAudioProvider";
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
  active: _active,
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
  const stopPlayRef = useRef<(() => void) | null>(null);
  /** Blob URL created for dictation audio — revoked on unmount. */
  const blobUrlRef = useRef<string | null>(null);

  // Revoke blob URL on unmount to avoid memory leaks.
  useEffect(() => {
    return () => {
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
      stopPlayRef.current?.();
    };
  }, []);

  // When audio is already loaded (Listen tab was visited), compute segments.
  useEffect(() => {
    if (audio.isLoaded && !audio.isFallback && audio.words.length > 0 && segments.length === 0) {
      const segs = segmentDictation(plainText, audio.words);
      setSegments(segs);
      setPhase(segs.length > 0 ? "idle" : "fallback");
    } else if (audio.isFallback && phase === "warming") {
      setPhase("fallback");
    }
  }, [audio.isLoaded, audio.isFallback, audio.words, plainText, segments.length, phase]);

  // Warm narration lazily on first render if not already loaded.
  useEffect(() => {
    if (warmStartedRef.current || audio.isLoaded) return;
    warmStartedRef.current = true;
    void warmNarration();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function warmNarration() {
    try {
      const res = await fetch(`/api/reader/${articleId}/speech`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Could not load narration");
      }
      const body = (await res.json()) as {
        audio: string | null;
        mimeType: string | null;
        spokenText: string;
        words: typeof audio.words;
        voice: string;
        cached: boolean;
        fallback: boolean;
      };

      if (body.fallback || !body.audio) {
        audio.markFallback();
        setPhase("fallback");
        return;
      }

      // Convert base64 → Blob URL (CSP-safe, avoids data: URI restriction).
      const base64 = body.audio.includes(",") ? body.audio.split(",")[1] : body.audio;
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: body.mimeType ?? "audio/mpeg" });
      const blobUrl = URL.createObjectURL(blob);
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = blobUrl;
      audio.loadAudio(blobUrl, body.words, body.voice, body.cached, plainText);
      const segs = segmentDictation(plainText, body.words);
      setSegments(segs);
      setPhase(segs.length > 0 ? "idle" : "fallback");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Could not load narration");
      setPhase("error");
    }
  }

  const currentSegment = segments[currentIdx] ?? null;

  function handlePlay() {
    if (!currentSegment) return;
    const audioEl = audio.audioRef.current;
    if (!audioEl) return;

    // Cancel any running range playback.
    stopPlayRef.current?.();

    let cancelled = false;
    function onTimeUpdate() {
      if (cancelled) return;
      if (audioEl!.currentTime >= currentSegment!.endTime + 0.05) {
        cancelled = true;
        audioEl!.pause();
        audioEl!.removeEventListener("timeupdate", onTimeUpdate);
        stopPlayRef.current = null;
        setPhase((p) => (p === "playing" ? "idle" : p));
      }
    }

    audioEl.addEventListener("timeupdate", onTimeUpdate);
    stopPlayRef.current = () => {
      cancelled = true;
      audioEl.removeEventListener("timeupdate", onTimeUpdate);
    };

    audioEl.currentTime = currentSegment.startTime;
    void audioEl.play();
    setPhase("playing");
  }

  function handleStop() {
    stopPlayRef.current?.();
    stopPlayRef.current = null;
    audio.audioRef.current?.pause();
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
    stopPlayRef.current?.();
    audio.audioRef.current?.pause();
    setGrade(gradeDictation(currentSegment.text, typed));
    setPhase("graded");
  }

  function handleReset() {
    stopPlayRef.current?.();
    audio.audioRef.current?.pause();
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
        description="Dictation requires text-to-speech narration. Please check back after the article has been processed."
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
