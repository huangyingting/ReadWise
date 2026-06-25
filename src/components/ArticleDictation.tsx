"use client";

/**
 * ArticleDictation (Issue #40 — Listening & Dictation Exercise, REF-062 split)
 *
 * Thin composition: data/interaction state lives in useDictationPanel;
 * this file owns only the rendered output.
 *
 * Props:
 *   articleId  — used to lazily warm narration if the Listen tab hasn't been
 *                opened yet.
 *   plainText  — article body as plain text.
 *   active     — true when this panel is the visible tab.
 */

import { type ChangeEvent, type FormEvent } from "react";
import { ChevronLeft, ChevronRight, Headphones, RotateCcw } from "lucide-react";
import { cn, focusRing } from "@/lib/cn";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Textarea";
import EmptyState from "@/components/EmptyState";
import AiBadge from "@/components/AiBadge";
import {
  useDictationPanel,
  type DictationSegment,
  type DiffToken,
} from "@/components/reader/study/useDictationPanel";

export default function ArticleDictation({
  articleId,
  plainText,
  active,
}: {
  articleId: string;
  plainText: string;
  active: boolean;
}) {
  const panel = useDictationPanel(articleId, plainText, active);

  if (panel.phase === "warming") {
    return <p className="muted">Loading narration…</p>;
  }

  if (panel.phase === "fallback") {
    return (
      <EmptyState
        icon={Headphones}
        title="Narration not available"
        description="Audio for this article isn't ready yet. Check back in a few minutes."
      />
    );
  }

  if (panel.phase === "error") {
    return (
      <p className="tts-error" role="alert">
        {panel.errorMsg ?? "Could not load narration."}
      </p>
    );
  }

  if (panel.segments.length === 0) {
    return (
      <p className="muted">
        No practisable sentences found in this article.
      </p>
    );
  }

  return (
    <div className="rw-dictate-panel">
      {/* ── AI badge ── */}
      <div style={{ marginBottom: "var(--space-3)" }}>
        <AiBadge />
      </div>

      {/* ── Sentence navigator ── */}
      <SentenceNavigator
        currentIdx={panel.currentIdx}
        total={panel.segments.length}
        onPrev={panel.handlePrev}
        onNext={panel.handleNext}
      />

      {/* ── Play / stop ── */}
      <div className="rw-dictate-controls">
        {panel.phase !== "playing" ? (
          <Button
            variant="primary"
            size="sm"
            onClick={panel.handlePlay}
            aria-label="Play sentence"
          >
            <Headphones size={14} aria-hidden />
            Play sentence
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={panel.handleStop}
            aria-label="Stop playback"
          >
            Stop
          </Button>
        )}
      </div>

      {/* ── Input form ── */}
      <DictationForm
        typed={panel.typed}
        phase={panel.phase}
        onTyped={panel.handleTyped}
        onCheck={panel.handleCheck}
        onReset={panel.handleReset}
      />

      {/* ── Grading result ── */}
      {panel.phase === "graded" && panel.grade && panel.currentSegment && (
        <div
          className="rw-dictate-result"
          role="region"
          aria-label="Dictation result"
        >
          <ScoreBar accuracy={panel.grade.accuracy} />
          <DiffDisplay
            tokens={panel.grade.tokens}
            reference={panel.currentSegment.text}
          />
        </div>
      )}
    </div>
  );
}

// ─── Presentational sub-components ────────────────────────────────────────────

function SentenceNavigator({
  currentIdx,
  total,
  onPrev,
  onNext,
}: {
  currentIdx: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <div
      className="rw-dictate-stepper"
      role="navigation"
      aria-label="Sentence navigation"
    >
      <button
        type="button"
        className={cn("rw-dictate-stepper-btn", focusRing)}
        onClick={onPrev}
        disabled={currentIdx === 0}
        aria-label="Previous sentence"
      >
        <ChevronLeft size={16} aria-hidden />
      </button>
      <span className="rw-dictate-stepper-counter" aria-live="polite">
        {currentIdx + 1} / {total}
      </span>
      <button
        type="button"
        className={cn("rw-dictate-stepper-btn", focusRing)}
        onClick={onNext}
        disabled={currentIdx === total - 1}
        aria-label="Next sentence"
      >
        <ChevronRight size={16} aria-hidden />
      </button>
    </div>
  );
}

function DictationForm({
  typed,
  phase,
  onTyped,
  onCheck,
  onReset,
}: {
  typed: string;
  phase: string;
  onTyped: (e: ChangeEvent<HTMLTextAreaElement>) => void;
  onCheck: (e: FormEvent) => void;
  onReset: () => void;
}) {
  return (
    <form onSubmit={onCheck} className="rw-dictate-form">
      <label htmlFor="dictation-input" className="rw-dictate-label">
        Type what you heard:
      </label>
      <Textarea
        id="dictation-input"
        className={cn("rw-dictate-textarea", focusRing)}
        value={typed}
        onChange={onTyped}
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
            onClick={onReset}
            aria-label="Try again"
          >
            <RotateCcw size={13} aria-hidden />
            Try again
          </button>
        )}
      </div>
    </form>
  );
}

function ScoreBar({ accuracy }: { accuracy: number }) {
  const variant =
    accuracy >= 90
      ? "good"
      : accuracy >= 70
      ? "fair"
      : accuracy >= 50
      ? "poor"
      : "bad";

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
          className={cn(
            "rw-dictate-score-fill",
            `rw-dictate-score-fill--${variant}`,
          )}
          style={{ width: `${accuracy}%` }}
        />
      </div>
      <span className="rw-dictate-score-label" aria-hidden>
        {accuracy}%
      </span>
    </div>
  );
}

function DiffDisplay({
  tokens,
  reference,
}: {
  tokens: DiffToken[];
  reference: string;
}) {
  return (
    <div className="rw-dictate-diff" aria-label="Word-level feedback" lang="en">
      <p className="rw-dictate-diff-hint muted">
        Reference: <em>{reference}</em>
      </p>
      <p className="rw-dictate-diff-tokens" aria-live="polite">
        {tokens.map((tok, i) => {
          if (tok.status === "correct") {
            return (
              <span
                key={i}
                className="rw-dictate-word rw-dictate-word--correct"
                title="Correct"
              >
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
                <span className="rw-dictate-correction" aria-hidden>
                  {" "}
                  → {tok.word}
                </span>
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
