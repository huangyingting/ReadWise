"use client";

/**
 * ArticleDifficultyFeedback (#124)
 *
 * A quick "How was the difficulty?" widget rendered at the end of each reader
 * article. Three buttons: Too Easy / Just Right / Too Hard. Clicking saves
 * the vote via POST /api/reader/[id]/difficulty-feedback and thanks the user.
 * After voting the widget is replaced by a "You rated: …" message.
 */

import { useState } from "react";
import { cn, focusRing } from "@/lib/cn";

type Vote = "too_easy" | "just_right" | "too_hard";

const OPTIONS: { value: Vote; emoji: string; label: string }[] = [
  { value: "too_easy", emoji: "😴", label: "Too Easy" },
  { value: "just_right", emoji: "🎯", label: "Just Right" },
  { value: "too_hard", emoji: "🤯", label: "Too Hard" },
];

const VOTE_LABEL: Record<Vote, string> = {
  too_easy: "Too Easy",
  just_right: "Just Right",
  too_hard: "Too Hard",
};

export default function ArticleDifficultyFeedback({
  articleId,
  initialVote,
  difficulty,
}: {
  articleId: string;
  initialVote?: Vote | null;
  difficulty?: string | null;
}) {
  const [vote, setVote] = useState<Vote | null>(initialVote ?? null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleVote(v: Vote) {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/reader/${articleId}/difficulty-feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vote: v }),
      });
      if (!res.ok) {
        setError("Couldn't save your feedback — please try again.");
        return;
      }
      setVote(v);
    } catch {
      setError("Couldn't save your feedback — please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      className="reader-difficulty-feedback"
      aria-label="Article difficulty feedback"
    >
      <h3 className="text-[length:var(--text-sm)] font-semibold text-text-muted uppercase tracking-wide mb-[var(--space-3)] mt-0">
        How was the difficulty?
      </h3>
      {difficulty ? (
        <p className="text-[length:var(--text-xs)] text-text-subtle m-0 mb-[var(--space-3)]">
          AI-estimated level: <strong className="text-text-muted">{difficulty}</strong>
        </p>
      ) : null}

      {vote ? (
        <p className="text-[length:var(--text-sm)] text-text-muted m-0">
          <span aria-hidden="true">✓ </span>
          You rated this article: <strong className="text-text">{VOTE_LABEL[vote]}</strong>
          {" "}— thanks for your feedback!
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-[var(--space-2)]" role="group" aria-label="Difficulty rating buttons">
            {OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => void handleVote(opt.value)}
                disabled={saving}
                aria-label={opt.label}
                className={cn(
                  "inline-flex items-center gap-[var(--space-1-5)] h-9 px-[var(--space-3)]",
                  "rounded-[var(--radius-full)] border text-[length:var(--text-sm)] font-medium",
                  "bg-surface border-border text-text-muted",
                  "transition-colors [transition-duration:var(--duration-fast)]",
                  "hover:border-border-strong hover:text-text hover:bg-bg-subtle",
                  "disabled:opacity-50 disabled:cursor-not-allowed",
                  focusRing,
                )}
              >
                <span aria-hidden="true">{opt.emoji}</span>
                {opt.label}
              </button>
            ))}
          </div>
          {error ? (
            <p role="alert" className="text-[length:var(--text-sm)] text-danger-text mt-[var(--space-2)] m-0">
              {error}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
