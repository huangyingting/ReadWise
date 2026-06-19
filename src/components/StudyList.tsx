"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";

export type StudyWord = {
  id: string;
  word: string;
  explanation: string | null;
  example: string | null;
  articleId: string | null;
};

export default function StudyList({
  words,
  reviewing = false,
}: {
  words: StudyWord[];
  /** When true, dims and inerts the list while a flashcard session is active. */
  reviewing?: boolean;
}) {
  const [items, setItems] = useState<StudyWord[]>(words);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function remove(word: StudyWord) {
    if (pending) {
      return;
    }
    setPending(word.id);
    setError(null);
    try {
      const res = await fetch("/api/vocabulary/unsave", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ word: word.word }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(data?.error ?? "Could not remove word");
      }
      setItems((prev) => prev.filter((it) => it.id !== word.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove word");
    } finally {
      setPending(null);
    }
  }

  if (items.length === 0) {
    return (
      <p className="muted">
        Your study list is empty. Open an article and save vocabulary to build
        it up.
      </p>
    );
  }

  return (
    <div
      {...(reviewing ? { inert: true } : {})}
      className={cn(
        "transition-opacity [transition-duration:var(--duration-base)] motion-reduce:transition-none",
        reviewing && "opacity-60",
      )}
      aria-hidden={reviewing || undefined}
    >
      {error ? (
        <p className="vocabulary-error" role="alert">
          {error}
        </p>
      ) : null}
      <ul className="vocabulary-list">
        {items.map((item) => (
          <li key={item.id} className="vocabulary-item">
            <div className="vocabulary-item-main">
              <strong className="vocabulary-word">{item.word}</strong>
              {item.explanation ? (
                <p className="vocabulary-explanation">{item.explanation}</p>
              ) : null}
              {item.example ? (
                <p className="vocabulary-example muted">&ldquo;{item.example}&rdquo;</p>
              ) : null}
            </div>
            <button
              type="button"
              className="btn vocabulary-save is-saved"
              onClick={() => remove(item)}
              disabled={pending === item.id}
            >
              {pending === item.id ? "…" : "Remove"}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
