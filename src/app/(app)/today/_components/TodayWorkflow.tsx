"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { BookOpen, CheckCircle2, GraduationCap, SkipForward } from "lucide-react";
import { submitTodayAction } from "@/lib/offline/today-client";
import { subscribeTodayConflicts } from "@/lib/offline/sync-runtime";
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

type SkipReason = (typeof SKIP_REASON_OPTIONS)[number]["value"];

type StepView = {
  key: keyof TodaySteps;
  title: string;
  hint: string;
  href?: string;
  hrefLabel?: string;
};

type NoticeKind = "status" | "alert";
type BusyAction = "read" | "skip";

function buildStepViews(steps: TodaySteps, primaryHref: string | null): StepView[] {
  return [
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
      hint: "Do the quick comprehension check-in below, or take the reader quiz.",
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
}

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

function TodayStepList({
  steps,
  stepViews,
}: {
  steps: TodaySteps;
  stepViews: StepView[];
}) {
  return (
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
  );
}

function WorkflowNotice({
  kind,
  children,
}: {
  kind: NoticeKind;
  children: string;
}) {
  return (
    <p
      role={kind}
      className={`m-0 text-[length:var(--text-sm)] ${
        kind === "alert" ? "text-danger-text" : "text-text-muted"
      }`}
    >
      {children}
    </p>
  );
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
  /** Authenticated user id — used only to key Today action delivery. */
  userId: string;
  /** Learner's local calendar date, "YYYY-MM-DD" (action-delivery anchor). */
  localDate: string;
  /** Learner's IANA timezone snapshot for this Today session. */
  timezone: string;
}

/**
 * Client workflow controls for the Today page: the reading → comprehension →
 * word-review step tracker, a manual "mark today's reading done" fallback, and
 * a controlled skip action. Mutations go through the Today API routes and then
 * refresh the server-rendered view; no learning content is sent or stored.
 *
 * When immediate delivery is unavailable, skip / mark-read actions are queued
 * with privacy-safe ids/enums/dates only and replayed later. A replayed action
 * the server already resolved on
 * another device surfaces a non-blocking conflict notice — never a data loss.
 */
export default function TodayWorkflow({
  steps,
  active,
  readingComplete,
  primaryHref,
  completed,
  userId,
  localDate,
  timezone,
}: TodayWorkflowProps) {
  const router = useRouter();
  const [busy, setBusy] = useState<BusyAction | null>(null);
  const [skipReason, setSkipReason] = useState<SkipReason>(SKIP_REASON_OPTIONS[0].value);
  const [error, setError] = useState<string | null>(null);
  const [skipNotice, setSkipNotice] = useState<string | null>(null);
  const [queuedNotice, setQueuedNotice] = useState<string | null>(null);
  const [conflictNotice, setConflictNotice] = useState<string | null>(null);

  // Surface a non-blocking notice when a replayed Today action conflicted with
  // server state already resolved on another device (ids/status only).
  useEffect(() => {
    return subscribeTodayConflicts(() => {
      setConflictNotice(
        "Some offline actions couldn't be applied — your progress is safe.",
      );
    });
  }, []);

  const actionContext = { userId, localDate, timezone };
  const stepViews = buildStepViews(steps, primaryHref);

  async function markRead() {
    setBusy("read");
    setError(null);
    setQueuedNotice(null);
    try {
      const outcome = await submitTodayAction(actionContext, {
        type: "today.read-complete",
      });
      if (outcome.kind === "queued") {
        setQueuedNotice("Today's reading is saved and will sync automatically.");
        return;
      }
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
    setQueuedNotice(null);
    try {
      const outcome = await submitTodayAction(actionContext, {
        type: "today.skip",
        skipReason,
      });
      if (outcome.kind === "queued") {
        setQueuedNotice("Your skip is saved and will sync automatically.");
        return;
      }
      if (outcome.result.limitReached) {
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

          <TodayStepList steps={steps} stepViews={stepViews} />
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
                  onChange={(e) => setSkipReason(e.target.value as SkipReason)}
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
        <WorkflowNotice kind="status">{skipNotice}</WorkflowNotice>
      ) : null}
      {queuedNotice ? (
        <WorkflowNotice kind="status">{queuedNotice}</WorkflowNotice>
      ) : null}
      {conflictNotice ? (
        <WorkflowNotice kind="status">{conflictNotice}</WorkflowNotice>
      ) : null}
      {error ? (
        <WorkflowNotice kind="alert">{error}</WorkflowNotice>
      ) : null}
    </Stack>
  );
}
