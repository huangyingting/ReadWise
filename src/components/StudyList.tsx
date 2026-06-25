"use client";

import { useState, useEffect, useCallback } from "react";
import { BookOpen, Volume2 } from "lucide-react";
import { postJson } from "@/lib/client-fetch";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/Button";
import EmptyState from "@/components/EmptyState";

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
  const [speechAvailable, setSpeechAvailable] = useState(false);
  const [speaking, setSpeaking] = useState<string | null>(null);

  useEffect(() => {
    setSpeechAvailable("speechSynthesis" in window);
  }, []);

  const speak = useCallback(
    (item: StudyWord) => {
      if (!("speechSynthesis" in window)) return;
      // Toggle off if already speaking this word.
      if (speaking === item.id) {
        window.speechSynthesis.cancel();
        setSpeaking(null);
        return;
      }
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(item.word);
      utterance.onend = () => setSpeaking(null);
      utterance.onerror = () => setSpeaking(null);
      setSpeaking(item.id);
      window.speechSynthesis.speak(utterance);
    },
    [speaking],
  );

  async function remove(word: StudyWord) {
    if (pending) {
      return;
    }
    setPending(word.id);
    setError(null);
    try {
      await postJson("/api/vocabulary/unsave", { word: word.word });
      setItems((prev) => prev.filter((it) => it.id !== word.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove word");
    } finally {
      setPending(null);
    }
  }

  if (items.length === 0) {
    return (
      <EmptyState
        icon={BookOpen}
        title="Your study list is empty"
        description="Open an article and save vocabulary words to build it up."
        action={{ label: "Browse articles", href: "/browse" }}
      />
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
            <div className="vocabulary-item-actions">
              {speechAvailable ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="md"
                  onClick={() => speak(item)}
                  aria-label={`Play pronunciation of ${item.word}`}
                  aria-pressed={speaking === item.id}
                  className={cn(
                    "min-h-[44px] min-w-[44px] p-0 shrink-0",
                    speaking === item.id && "text-primary",
                  )}
                >
                  <Volume2 size={18} aria-hidden />
                </Button>
              ) : null}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => remove(item)}
                disabled={pending === item.id}
              >
                {pending === item.id ? "…" : "Remove"}
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
