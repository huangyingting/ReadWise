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
import { useMutation } from "@/hooks/useMutation";
import { postJson } from "@/lib/client-fetch";
import { Button } from "@/components/ui";

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
  const { busy: saving, error, run } = useMutation(
    "Couldn't save your feedback — please try again.",
  );

  async function handleVote(v: Vote) {
    if (saving) return;
    await run(async () => {
      try {
        await postJson(`/api/reader/${articleId}/difficulty-feedback`, { vote: v });
      } catch {
        throw new Error("Couldn't save your feedback — please try again.");
      }
      setVote(v);
    });
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
              <Button
                key={opt.value}
                variant="outline"
                size="sm"
                onClick={() => void handleVote(opt.value)}
                disabled={saving}
                aria-label={opt.label}
                className="rounded-[var(--radius-full)] text-text-muted hover:text-text"
              >
                <span aria-hidden="true">{opt.emoji}</span>
                {opt.label}
              </Button>
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
