"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { BookOpen, CheckCircle2, Lightbulb, Sparkles } from "lucide-react";
import { getJson, postJson } from "@/lib/client-fetch";
import { submitTodayMutation, isOffline } from "@/lib/offline/today-client";
import { Badge, Button, buttonVariants, Card, Inline, Stack } from "@/components/ui";

/** Controlled self-rating answers (mirror COMPREHENSION_SELF_RATINGS). */
const SELF_RATING_OPTIONS = [
  { value: "confident", label: "I understood it well" },
  { value: "partial", label: "I mostly got it" },
  { value: "confused", label: "I'm not sure I got it" },
] as const;

type SelfRating = (typeof SELF_RATING_OPTIONS)[number]["value"];

type CheckQuestion = { id: string; question: string; options: string[] };

type CheckPayload = {
  available: boolean;
  articleId: string | null;
  question: CheckQuestion | null;
  completed: boolean;
  alreadySubmitted: boolean;
};

type SubmitResult = {
  updated: boolean;
  mcqCorrect: boolean | null;
  remediation: { show: boolean; articleHref: string | null };
};

export interface TodayComprehensionCheckProps {
  /** True once the day's reading step is complete (gate for showing the check). */
  readingComplete: boolean;
  /** True once the comprehension step is already complete. */
  comprehensionComplete: boolean;
  /** True while the session is still active. */
  active: boolean;
  /** Authenticated user id — used only to key offline Today mutations. */
  userId: string;
  /** Learner's local calendar date, "YYYY-MM-DD" (offline mutation anchor). */
  localDate: string;
  /** Learner's IANA timezone snapshot for this Today session. */
  timezone: string;
}

/**
 * Low-pressure post-reading comprehension self-check (#807). Offers a single
 * self-rating plus an OPTIONAL one-question MCQ drawn from the article's existing
 * quiz. The self-rating alone completes the Today comprehension step — no full
 * quiz required. A wrong MCQ answer reveals a gentle remediation card linking
 * back to the article. No learning content is ever stored; only the rating,
 * the question id, and the boolean outcome leave the browser.
 *
 * When offline, the check-in is enqueued in the offline mutation queue (rating /
 * question id / selected index only) and replayed when connectivity returns.
 */
export default function TodayComprehensionCheck({
  readingComplete,
  comprehensionComplete,
  active,
  userId,
  localDate,
  timezone,
}: TodayComprehensionCheckProps) {
  const router = useRouter();
  const [check, setCheck] = useState<CheckPayload | null>(null);
  const [selfRating, setSelfRating] = useState<SelfRating | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offlineNotice, setOfflineNotice] = useState<string | null>(null);

  const shouldOffer = readingComplete && !comprehensionComplete && active;

  useEffect(() => {
    if (!shouldOffer) return;
    let cancelled = false;
    getJson<CheckPayload>("/api/today/comprehension")
      .then((data) => {
        if (!cancelled) setCheck(data);
      })
      .catch(() => {
        if (!cancelled) setCheck({
          available: true,
          articleId: null,
          question: null,
          completed: false,
          alreadySubmitted: false,
        });
      });
    return () => {
      cancelled = true;
    };
  }, [shouldOffer]);

  const submit = useCallback(async () => {
    if (!selfRating) return;
    setBusy(true);
    setError(null);
    setOfflineNotice(null);
    try {
      if (isOffline()) {
        const hasMcq = check?.question != null;
        await submitTodayMutation(
          "today.comprehension",
          { userId, localDate, timezone },
          {
            selfRating,
            ...(hasMcq && check?.question?.id
              ? { questionId: check.question.id }
              : {}),
            ...(hasMcq && selectedIndex != null
              ? { selectedIndex }
              : {}),
          },
        );
        setOfflineNotice(
          "You're offline — your check-in is saved and will sync when you reconnect.",
        );
        return;
      }
      const res = await postJson<SubmitResult>("/api/today/comprehension", {
        selfRating,
        questionId: check?.question?.id,
        selectedIndex: check?.question ? selectedIndex ?? undefined : undefined,
      });
      setResult(res);
      // Refresh the server-rendered step tracker (comprehension is now done).
      router.refresh();
    } catch {
      setError("Couldn't save your check-in. Please try again.");
    } finally {
      setBusy(false);
    }
  }, [check, localDate, router, selectedIndex, selfRating, timezone, userId]);

  if (!shouldOffer) return null;

  // Once submitted, show a celebratory note and (on a wrong answer) remediation.
  if (result?.updated) {
    return (
      <Card>
        <Stack gap="3">
          <Inline gap="2" align="center">
            <Badge variant="success">
              <CheckCircle2 size={14} aria-hidden /> Comprehension checked
            </Badge>
          </Inline>
          {result.remediation.show ? (
            <Stack gap="2">
              <Inline gap="2" align="center">
                <Lightbulb size={18} aria-hidden className="text-text-muted" />
                <span className="text-[length:var(--text-base)] font-semibold text-text">
                  Let&apos;s revisit the key idea
                </span>
              </Inline>
              <span className="text-[length:var(--text-sm)] text-text-muted">
                No worries — give the article another quick read to lock it in.
              </span>
              {result.remediation.articleHref ? (
                <div>
                  <Link
                    href={result.remediation.articleHref}
                    className={buttonVariants({ variant: "secondary", size: "sm" })}
                  >
                    <BookOpen size={16} aria-hidden />
                    Go back to the article
                  </Link>
                </div>
              ) : null}
            </Stack>
          ) : (
            <span className="text-[length:var(--text-sm)] text-text-muted">
              Nice — thanks for the quick check-in. It helps tune what you read next.
            </span>
          )}
        </Stack>
      </Card>
    );
  }

  return (
    <Card>
      <Stack gap="4">
        <Inline gap="2" align="center">
          <Sparkles size={18} aria-hidden className="text-text-muted" />
          <h2 className="m-0 font-[family-name:var(--font-display)] text-[length:var(--text-lg)] font-semibold text-text">
            Quick comprehension check
          </h2>
        </Inline>
        <span className="text-[length:var(--text-sm)] text-text-muted">
          A low-pressure check-in — there&apos;s no score. How well did you
          understand today&apos;s article?
        </span>

        <fieldset className="m-0 flex flex-col gap-[var(--space-2)] border-0 p-0">
          <legend className="sr-only">How well did you understand the article?</legend>
          <Inline gap="2" align="center">
            {SELF_RATING_OPTIONS.map((opt) => (
              <Button
                key={opt.value}
                type="button"
                variant={selfRating === opt.value ? "primary" : "outline"}
                size="sm"
                aria-pressed={selfRating === opt.value}
                onClick={() => setSelfRating(opt.value)}
              >
                {opt.label}
              </Button>
            ))}
          </Inline>
        </fieldset>

        {check?.question ? (
          <fieldset className="m-0 flex flex-col gap-[var(--space-2)] border-0 p-0">
            <legend className="text-[length:var(--text-sm)] font-semibold text-text">
              {check.question.question}
            </legend>
            <Stack gap="2">
              {check.question.options.map((option, index) => (
                <Button
                  key={index}
                  type="button"
                  variant={selectedIndex === index ? "primary" : "outline"}
                  size="sm"
                  aria-pressed={selectedIndex === index}
                  className="justify-start text-left"
                  onClick={() => setSelectedIndex(index)}
                >
                  {option}
                </Button>
              ))}
            </Stack>
          </fieldset>
        ) : null}

        <div>
          <Button
            type="button"
            variant="secondary"
            loading={busy}
            disabled={!selfRating}
            onClick={submit}
          >
            Save check-in
          </Button>
        </div>

        {error ? (
          <p role="alert" className="m-0 text-[length:var(--text-sm)] text-danger-text">
            {error}
          </p>
        ) : null}
        {offlineNotice ? (
          <p role="status" className="m-0 text-[length:var(--text-sm)] text-text-muted">
            {offlineNotice}
          </p>
        ) : null}
      </Stack>
    </Card>
  );
}
