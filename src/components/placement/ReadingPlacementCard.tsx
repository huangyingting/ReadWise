"use client";

import { useCallback, useEffect, useState } from "react";
import { getJson, postJson } from "@/lib/client-fetch";
import { useMutation } from "@/hooks/useMutation";
import {
  Card,
  CardHeader,
  CardTitle,
  CardMeta,
  CardBody,
  CardFooter,
  Button,
  Badge,
  CefrBadge,
  Spinner,
} from "@/components/ui";
import type { PlacementSeedLevel } from "@/lib/learning/placement";
import type { EnglishLevel } from "@/lib/leveling/cefr-primitives";

/**
 * Reading placement card (#806).
 *
 * Fetches a curated public-library passage for the learner's seed level,
 * renders a short self-check, then posts ONLY the structured outcome
 * (correct/total/lookup counts) to `POST /api/placement`. Passage and question
 * text live in component state and are never persisted. Fully skippable.
 */

type PlacementQuestionDto = {
  id: string;
  question: string;
  options: string[];
  correctIndex: number;
};

type PlacementPassageDto = {
  articleId: string;
  seedLevel: PlacementSeedLevel;
  title: string;
  excerpt: string | null;
  wordCount: number;
  questions: PlacementQuestionDto[];
};

type PlacementFetch =
  | { available: true; passage: PlacementPassageDto }
  | { available: false };

type PlacementSubmitResponse = {
  ok: boolean;
  recommendedLevel: string;
  skipped: boolean;
};

export type ReadingPlacementCardProps = {
  seedLevel: PlacementSeedLevel;
  attempt?: "initial" | "retake";
  /** Called after the learner submits, skips, or dismisses the card. */
  onDone?: () => void;
  className?: string;
};

export function ReadingPlacementCard({
  seedLevel,
  attempt = "initial",
  onDone,
  className,
}: ReadingPlacementCardProps) {
  const [loading, setLoading] = useState(true);
  const [passage, setPassage] = useState<PlacementPassageDto | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [lookupCount, setLookupCount] = useState(0);
  const [result, setResult] = useState<string | null>(null);

  const { busy, error, run } = useMutation("Could not save your placement. Please try again.");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setUnavailable(false);
    getJson<PlacementFetch>(`/api/placement?seedLevel=${encodeURIComponent(seedLevel)}`)
      .then((res) => {
        if (!active) return;
        if (res.available) setPassage(res.passage);
        else setUnavailable(true);
      })
      .catch(() => {
        if (active) setUnavailable(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [seedLevel]);

  const selectAnswer = useCallback((questionId: string, optionIndex: number) => {
    setAnswers((prev) => ({ ...prev, [questionId]: optionIndex }));
  }, []);

  const submit = useCallback(
    (skipped: boolean) => {
      if (!passage) return;
      const correctCount = skipped
        ? 0
        : passage.questions.reduce(
            (acc, q) => acc + (answers[q.id] === q.correctIndex ? 1 : 0),
            0,
          );
      run(
        async () =>
          postJson<PlacementSubmitResponse>("/api/placement", {
            articleId: passage.articleId,
            seedLevel: passage.seedLevel,
            correctCount,
            totalCount: skipped ? 0 : passage.questions.length,
            lookupCount: skipped ? 0 : lookupCount,
            skipped,
            attempt,
          }),
        {
          onSuccess: (res) => {
            setResult(res.recommendedLevel);
          },
        },
      );
    },
    [passage, answers, lookupCount, attempt, run],
  );

  // Nothing to place against — degrade gracefully (never blocks onboarding).
  if (unavailable) return null;

  if (loading) {
    return (
      <Card className={className}>
        <CardBody>
          <div className="flex items-center gap-[var(--space-3)] text-text-muted text-[length:var(--text-sm)]">
            <Spinner size="sm" /> Loading a short placement passage…
          </div>
        </CardBody>
      </Card>
    );
  }

  if (!passage) return null;

  if (result) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle level="h2">Placement complete</CardTitle>
          <CardMeta>
            We&apos;ll start your reading recommendations around this level. You can
            retake placement any time from Settings.
          </CardMeta>
        </CardHeader>
        <CardBody>
          <div className="flex items-center gap-[var(--space-2)] text-text text-[length:var(--text-sm)]">
            Recommended starting level: <CefrBadge level={result as EnglishLevel} />
          </div>
        </CardBody>
        <CardFooter>
          <Button variant="primary" size="sm" onClick={onDone}>
            Continue
          </Button>
        </CardFooter>
      </Card>
    );
  }

  const allAnswered = passage.questions.every((q) => answers[q.id] !== undefined);

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle level="h2">
          Quick reading placement{" "}
          <Badge variant="neutral" className="ml-[var(--space-2)]">
            Optional
          </Badge>
        </CardTitle>
        <CardMeta>
          Read the short passage and answer {passage.questions.length} questions so we
          can tune your first recommendations. Takes about 5 minutes.
        </CardMeta>
      </CardHeader>
      <CardBody>
        <div className="flex flex-col gap-[var(--space-5)]">
          <div className="reading-prose text-[length:var(--text-sm)] text-text">
            <p className="font-semibold mb-[var(--space-2)]">{passage.title}</p>
            {passage.excerpt ? <p>{passage.excerpt}</p> : null}
          </div>

          {passage.questions.map((q, qi) => (
            <fieldset key={q.id} className="border-0 p-0 m-0 flex flex-col gap-[var(--space-2)]">
              <legend className="text-text font-medium text-[length:var(--text-sm)] mb-[var(--space-1)]">
                {qi + 1}. {q.question}
              </legend>
              <div className="flex flex-col gap-[var(--space-2)]">
                {q.options.map((opt, oi) => (
                  <label
                    key={oi}
                    className="flex items-center gap-[var(--space-3)] border border-border-strong rounded-[var(--radius-md)] p-[var(--space-3)] cursor-pointer text-[length:var(--text-sm)] text-text bg-surface hover:border-text-subtle has-[:focus-visible]:[box-shadow:0_0_0_2px_var(--ring-offset),0_0_0_4px_var(--focus-ring)]"
                  >
                    <input
                      type="radio"
                      name={`placement-${q.id}`}
                      checked={answers[q.id] === oi}
                      onChange={() => selectAnswer(q.id, oi)}
                      className="accent-[var(--primary)]"
                    />
                    {opt}
                  </label>
                ))}
              </div>
            </fieldset>
          ))}

          <div className="flex items-center gap-[var(--space-3)] text-text-muted text-[length:var(--text-sm)]">
            <span>Looked up a word while reading?</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setLookupCount((n) => n + 1)}
            >
              + Add a lookup
            </Button>
            <span aria-live="polite">{lookupCount} counted</span>
          </div>

          {error ? (
            <p role="alert" className="text-danger-text text-[length:var(--text-sm)]">
              {error}
            </p>
          ) : null}
        </div>
      </CardBody>
      <CardFooter>
        <div className="flex gap-[var(--space-2)]">
          <Button
            variant="primary"
            size="sm"
            disabled={!allAnswered || busy}
            onClick={() => submit(false)}
          >
            {busy ? "Saving…" : "Finish placement"}
          </Button>
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => submit(true)}>
            Skip
          </Button>
        </div>
      </CardFooter>
    </Card>
  );
}

export default ReadingPlacementCard;
