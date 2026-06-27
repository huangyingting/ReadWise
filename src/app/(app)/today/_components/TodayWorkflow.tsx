"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { BookOpen, CheckCircle2, GraduationCap, SkipForward } from "lucide-react";
import { postJson } from "@/lib/client-fetch";
import {
  Badge,
  Button,
  Card,
  Inline,
  Select,
  Stack,
} from "@/components/ui";
import type {
  TodaySteps,
  TodayStepState,
} from "@/lib/engagement/today-session";

/** Controlled skip reasons surfaced to the learner (mirrors TODAY_SKIP_REASONS). */
const SKIP_REASON_OPTIONS = [
  { value: "not_interested", label: "Not interested in this one" },
  { value: "too_busy", label: "Too busy today" },
  { value: "too_hard", label: "Too hard" },
  { value: "too_easy", label: "Too easy" },
  { value: "other", label: "Another reason" },
] as const;

type StepView = {
  key: keyof TodaySteps;
  title: string;
  hint: string;
  href?: string;
  hrefLabel?: string;
};

function stepBadge(state: TodayStepState) {
  if (state === "complete") {
    return (
      <Badge variant="success">
        <CheckCircle2 size={14} aria-hidden /> Done
      </Badge>
    );
  }
  if (state === "unavailable") {
    return <Badge variant="neutral">Not needed today</Badge>;
  }
  return <Badge variant="primary">To do</Badge>;
}

export interface TodayWorkflowProps {
  steps: TodaySteps;
  /** True while the session is still active (skippable, reading completable). */
  active: boolean;
  /** Whether the day already has a completed reading step. */
  readingComplete: boolean;
  /** Href to open the primary article in the reader (for comprehension). */
  primaryHref: string | null;
  /** Whether the whole day is complete. */
  completed: boolean;
}

/**
 * Client workflow controls for the Today page: the reading → comprehension →
 * word-review step tracker, a manual "mark today's reading done" fallback, and
 * a controlled skip action. Mutations go through the Today API routes and then
 * refresh the server-rendered view; no learning content is sent or stored.
 */
export default function TodayWorkflow({
  steps,
  active,
  readingComplete,
  primaryHref,
  completed,
}: TodayWorkflowProps) {
  const router = useRouter();
  const [busy, setBusy] = useState<null | "read" | "skip">(null);
  const [skipReason, setSkipReason] = useState<string>(SKIP_REASON_OPTIONS[0].value);
  const [error, setError] = useState<string | null>(null);
  const [skipNotice, setSkipNotice] = useState<string | null>(null);

  const stepViews: StepView[] = [
    {
      key: "reading",
      title: "Read the article",
      hint: "Read today's article at your own pace.",
      href: primaryHref ?? undefined,
      hrefLabel: "Open reader",
    },
    {
      key: "comprehension",
      title: "Check comprehension",
      hint: "Take the quick quiz or rate the difficulty in the reader.",
      href: primaryHref ?? undefined,
      hrefLabel: "Open reader",
    },
    {
      key: "wordReview",
      title: "Review your words",
      hint:
        steps.wordReview.available
          ? `Review ${steps.wordReview.targetCount} saved ${
              steps.wordReview.targetCount === 1 ? "word" : "words"
            } in Study.`
          : "No words to review today.",
      href: steps.wordReview.available ? "/study" : undefined,
      hrefLabel: "Open study",
    },
  ];

  async function markRead() {
    setBusy("read");
    setError(null);
    try {
      await postJson("/api/today/read-complete", {});
      router.refresh();
    } catch {
      setError("Couldn't mark today's reading done. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  async function skip() {
    setBusy("skip");
    setError(null);
    setSkipNotice(null);
    try {
      const res = await postJson<{ limitReached: boolean }>("/api/today/skip", {
        skipReason,
      });
      if (res.limitReached) {
        setSkipNotice("You've already skipped today — browse for something else to read.");
      }
      router.refresh();
    } catch {
      setError("Couldn't skip today. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Stack gap="5">
      <Card>
        <Stack gap="4">
          <Inline gap="2" align="center">
            <GraduationCap size={18} aria-hidden className="text-text-muted" />
            <h2 className="m-0 font-[family-name:var(--font-display)] text-[length:var(--text-lg)] font-semibold text-text">
              Today&apos;s steps
            </h2>
          </Inline>

          <ol className="m-0 list-none p-0">
            {stepViews.map((step, index) => {
              const state = steps[step.key].state;
              return (
                <li
                  key={step.key}
                  className="flex flex-col gap-[var(--space-2)] border-t border-border py-[var(--space-4)] first:border-t-0 first:pt-0 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex flex-col gap-[var(--space-1)]">
                    <Inline gap="2" align="center">
                      <span className="text-[length:var(--text-sm)] font-semibold text-text-muted">
                        {index + 1}.
                      </span>
                      <span className="text-[length:var(--text-base)] font-semibold text-text">
                        {step.title}
                      </span>
                    </Inline>
                    <span className="text-[length:var(--text-sm)] text-text-muted">
                      {step.hint}
                    </span>
                  </div>
                  <Inline gap="3" align="center">
                    {step.href && state !== "complete" && state !== "unavailable" ? (
                      <Link
                        href={step.href}
                        className="text-[length:var(--text-sm)] font-semibold text-primary-text underline underline-offset-2"
                      >
                        {step.hrefLabel}
                      </Link>
                    ) : null}
                    {stepBadge(state)}
                  </Inline>
                </li>
              );
            })}
          </ol>
        </Stack>
      </Card>

      {!completed && active ? (
        <Card>
          <Stack gap="4">
            {!readingComplete ? (
              <Stack gap="2">
                <span className="text-[length:var(--text-sm)] text-text-muted">
                  Read it offline or on paper? Mark today&apos;s reading done.
                </span>
                <div>
                  <Button
                    variant="secondary"
                    leadingIcon={<BookOpen size={16} aria-hidden />}
                    loading={busy === "read"}
                    onClick={markRead}
                  >
                    Mark reading done
                  </Button>
                </div>
              </Stack>
            ) : null}

            <Stack gap="2">
              <label
                htmlFor="today-skip-reason"
                className="text-[length:var(--text-sm)] text-text-muted"
              >
                Not feeling this one? Skip today.
              </label>
              <Inline gap="3" align="end">
                <Select
                  id="today-skip-reason"
                  value={skipReason}
                  onChange={(e) => setSkipReason(e.target.value)}
                  aria-label="Skip reason"
                >
                  {SKIP_REASON_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </Select>
                <Button
                  variant="ghost"
                  leadingIcon={<SkipForward size={16} aria-hidden />}
                  loading={busy === "skip"}
                  onClick={skip}
                >
                  Skip today
                </Button>
              </Inline>
            </Stack>
          </Stack>
        </Card>
      ) : null}

      {skipNotice ? (
        <p role="status" className="m-0 text-[length:var(--text-sm)] text-text-muted">
          {skipNotice}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="m-0 text-[length:var(--text-sm)] text-danger-text">
          {error}
        </p>
      ) : null}
    </Stack>
  );
}
