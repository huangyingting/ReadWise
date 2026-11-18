"use client";

/**
 * Reader activities (#1304): the pre-reading poll and Checks for
 * Understanding from the learner's assignments of this article, or — while
 * an educator previews the student view — from their own assignment
 * (responses are then kept locally and never saved).
 *
 *  - ReaderActivitiesProvider loads `/api/reader/[id]/activities` once.
 *  - ReaderPollCards renders "Before you read" polls above the prose.
 *  - ReaderCheckpoints unlocks each check when the reader passes its section,
 *    shows it as a dismissible checkpoint card, and lists every check after
 *    the article.
 *
 * Optional: a failed load renders nothing.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CheckCircle2, ListChecks, Vote, X, XCircle } from "lucide-react";
import { clientErrorMessage, getJson, postJson } from "@/lib/client-fetch";
import { Badge, Button, Card, CardBody, IconButton, PanelError } from "@/components/ui";
import { getObservedBlocks } from "./useCurrentReadingBlock";
import { useReaderLevel } from "./ReaderLevelContext";

type Poll = {
  id: string;
  assignmentId: string;
  classroomName: string;
  question: string;
  options: string[];
  myVote: number | null;
  distribution: number[] | null;
};

type CheckResult = { selectedIndex: number; correct: boolean; correctIndex: number; explanation: string | null };

type Check = {
  id: string;
  assignmentId: string;
  afterBlock: number;
  levelKey: string;
  question: string;
  options: string[];
  result: CheckResult | null;
};

type ActivitiesPayload = { mode: "student" | "preview" | "none"; polls: Poll[]; checks: Check[] };

type ActivitiesValue = ActivitiesPayload & {
  vote: (pollId: string, optionIndex: number) => Promise<void>;
  answer: (checkId: string, selectedIndex: number) => Promise<void>;
};

const EMPTY: ActivitiesPayload = { mode: "none", polls: [], checks: [] };

const ActivitiesContext = createContext<ActivitiesValue | null>(null);

function useActivities(): ActivitiesValue | null {
  return useContext(ActivitiesContext);
}

export function ReaderActivitiesProvider({
  articleId,
  preview,
  children,
}: {
  articleId: string;
  preview: boolean;
  children: ReactNode;
}) {
  const [data, setData] = useState<ActivitiesPayload>(EMPTY);

  useEffect(() => {
    let active = true;
    getJson<ActivitiesPayload>(`/api/reader/${encodeURIComponent(articleId)}/activities${preview ? "?preview=1" : ""}`)
      .then((payload) => {
        if (active) setData(payload);
      })
      .catch(() => {
        if (active) setData(EMPTY);
      });
    return () => {
      active = false;
    };
  }, [articleId, preview]);

  const vote = useCallback(
    async (pollId: string, optionIndex: number) => {
      if (data.mode === "preview") {
        setData((current) => ({
          ...current,
          polls: current.polls.map((poll) =>
            poll.id === pollId ? { ...poll, myVote: optionIndex } : poll,
          ),
        }));
        return;
      }
      const result = await postJson<{ myVote: number; distribution: number[] }>(
        `/api/assignment-polls/${encodeURIComponent(pollId)}/vote`,
        { optionIndex },
      );
      setData((current) => ({
        ...current,
        polls: current.polls.map((poll) => (poll.id === pollId ? { ...poll, ...result } : poll)),
      }));
    },
    [data.mode],
  );

  const answer = useCallback(
    async (checkId: string, selectedIndex: number) => {
      if (data.mode === "preview") {
        setData((current) => ({
          ...current,
          checks: current.checks.map((check) =>
            check.id === checkId
              ? { ...check, result: { selectedIndex, correct: false, correctIndex: -1, explanation: null } }
              : check,
          ),
        }));
        return;
      }
      const { result } = await postJson<{ result: CheckResult }>(
        `/api/assignment-checks/${encodeURIComponent(checkId)}/answer`,
        { selectedIndex },
      );
      setData((current) => ({
        ...current,
        checks: current.checks.map((check) => (check.id === checkId ? { ...check, result } : check)),
      }));
    },
    [data.mode],
  );

  const value = useMemo(() => ({ ...data, vote, answer }), [data, vote, answer]);
  return <ActivitiesContext.Provider value={value}>{children}</ActivitiesContext.Provider>;
}

function PreviewNote({ show }: { show: boolean }) {
  return show ? <Badge variant="warning">Preview — not saved</Badge> : null;
}

function PollCard({ poll, preview }: { poll: Poll; preview: boolean }) {
  const activities = useActivities();
  const [pending, setPending] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const total = poll.distribution?.reduce((sum, count) => sum + count, 0) ?? 0;
  const showResults = poll.myVote !== null && poll.distribution !== null;

  async function choose(index: number) {
    setPending(index);
    setError(null);
    try {
      await activities?.vote(poll.id, index);
    } catch (err) {
      setError(clientErrorMessage(err, "Couldn’t save your vote."));
    } finally {
      setPending(null);
    }
  }

  return (
    <Card className="mb-[var(--space-4)]" aria-labelledby={`poll-${poll.id}`}>
      <CardBody className="flex flex-col gap-[var(--space-3)]">
        <div className="flex flex-wrap items-center gap-[var(--space-2)]">
          <Vote size={16} aria-hidden="true" className="text-primary-text" />
          <span className="text-[length:var(--type-label)] font-semibold uppercase tracking-[var(--tracking-label)] text-text-muted">
            Before you read
          </span>
          <PreviewNote show={preview} />
        </div>
        <p id={`poll-${poll.id}`} className="m-0 text-[length:var(--type-body)] font-semibold text-text">
          {poll.question}
        </p>
        {showResults ? (
          <ul aria-label="Class results" className="m-0 flex list-none flex-col gap-[var(--space-2)] p-0">
            {poll.options.map((option, index) => {
              const count = poll.distribution?.[index] ?? 0;
              const percent = total === 0 ? 0 : Math.round((count / total) * 100);
              return (
                <li key={option} className="flex flex-col gap-[var(--space-1)]">
                  <span className="flex justify-between gap-[var(--space-2)] text-[length:var(--type-ui)] text-text">
                    <span>
                      {option}
                      {poll.myVote === index ? <span className="text-text-muted"> (your vote)</span> : null}
                    </span>
                    <span className="text-text-muted">{percent}%</span>
                  </span>
                  <span aria-hidden="true" className="block h-[var(--space-2)] overflow-hidden rounded-[var(--radius-full)] bg-bg-subtle">
                    <span className="block h-full rounded-[var(--radius-full)] bg-primary" style={{ width: `${percent}%` }} />
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <div role="group" aria-label={poll.question} className="flex flex-wrap gap-[var(--space-2)]">
            {poll.options.map((option, index) => (
              <Button
                key={option}
                type="button"
                size="sm"
                variant={poll.myVote === index ? "primary" : "outline"}
                loading={pending === index}
                disabled={pending !== null}
                onClick={() => void choose(index)}
              >
                {option}
              </Button>
            ))}
          </div>
        )}
        {showResults ? (
          <p className="m-0 text-[length:var(--type-ui)] text-text-muted">
            {total === 1 ? "1 vote" : `${total} votes`} from your class. There are no right answers.
          </p>
        ) : null}
        {error ? <PanelError message={error} /> : null}
      </CardBody>
    </Card>
  );
}

/** "Before you read" polls, above the prose. */
export function ReaderPollCards() {
  const activities = useActivities();
  if (!activities || activities.polls.length === 0) return null;
  return (
    <>
      {activities.polls.map((poll) => (
        <PollCard key={poll.id} poll={poll} preview={activities.mode === "preview"} />
      ))}
    </>
  );
}

function CheckBody({ check, preview, headingId }: { check: Check; preview: boolean; headingId: string }) {
  const activities = useActivities();
  const [pending, setPending] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const result = check.result;

  async function choose(index: number) {
    setPending(index);
    setError(null);
    try {
      await activities?.answer(check.id, index);
    } catch (err) {
      setError(clientErrorMessage(err, "Couldn’t save your answer."));
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex flex-col gap-[var(--space-3)]">
      <p id={headingId} className="m-0 text-[length:var(--type-body)] font-semibold text-text">
        {check.question}
      </p>
      <div role="group" aria-labelledby={headingId} className="flex flex-col gap-[var(--space-2)]">
        {check.options.map((option, index) => {
          const chosen = result?.selectedIndex === index;
          const isKey = result && result.correctIndex === index;
          return (
            <Button
              key={option}
              type="button"
              size="sm"
              variant={chosen ? "primary" : "outline"}
              className="justify-start text-left"
              aria-pressed={chosen}
              loading={pending === index}
              disabled={pending !== null || result !== null}
              onClick={() => void choose(index)}
            >
              {isKey ? <CheckCircle2 size={14} aria-hidden="true" /> : null}
              {option}
            </Button>
          );
        })}
      </div>
      {result && !preview ? (
        <p role="status" className="m-0 flex items-start gap-[var(--space-2)] text-[length:var(--type-ui)] text-text">
          {result.correct ? (
            <CheckCircle2 size={16} aria-hidden="true" className="shrink-0 text-success-text" />
          ) : (
            <XCircle size={16} aria-hidden="true" className="shrink-0 text-danger-text" />
          )}
          <span>
            {result.correct ? "Correct." : `Not quite — the answer is “${check.options[result.correctIndex]}”.`}
            {result.explanation ? ` ${result.explanation}` : ""}
          </span>
        </p>
      ) : null}
      {result && preview ? (
        <p role="status" className="m-0 text-[length:var(--type-ui)] text-text-muted">
          Preview: students see whether they were right and the explanation.
        </p>
      ) : null}
      {error ? <PanelError message={error} /> : null}
    </div>
  );
}

/**
 * Checks for Understanding: a checkpoint card appears when the reader passes
 * a check's section (dismissible), and every check is listed after the
 * article so it can be answered or reviewed at any time.
 */
export function ReaderCheckpoints() {
  const activities = useActivities();
  const checks = useMemo(() => activities?.checks ?? [], [activities?.checks]);
  // Only checks placed in the level being read can pop up at their section
  // (#1303); the rest are listed after the article.
  const level = useReaderLevel();
  const placed = useMemo(() => checks.filter((check) => check.levelKey === level), [checks, level]);
  const [reached, setReached] = useState<ReadonlySet<string>>(new Set());
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const [listVisible, setListVisible] = useState(false);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const listRef = useRef<HTMLElement | null>(null);

  // The floating card steps aside while the full list is on screen.
  useEffect(() => {
    const list = listRef.current;
    if (!list || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setListVisible(entry?.isIntersecting ?? false));
    observer.observe(list);
    return () => observer.disconnect();
  }, [checks.length]);

  useEffect(() => {
    if (placed.length === 0 || typeof IntersectionObserver === "undefined") return;
    const prose = document.querySelector<HTMLElement>(".word-lookup-prose");
    if (!prose) return;
    const blocks = getObservedBlocks(prose);
    if (blocks.length === 0) return;
    const byBlock = new Map<Element, string[]>();
    for (const check of placed) {
      const block = blocks[Math.min(check.afterBlock, blocks.length - 1)];
      byBlock.set(block, [...(byBlock.get(block) ?? []), check.id]);
    }
    observerRef.current?.disconnect();
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        // Reached once the section's last block has scrolled into or past view.
        if (entry.isIntersecting || entry.boundingClientRect.top < 0) {
          const ids = byBlock.get(entry.target) ?? [];
          setReached((current) => (ids.every((id) => current.has(id)) ? current : new Set([...current, ...ids])));
        }
      }
    });
    observerRef.current = observer;
    byBlock.forEach((_ids, block) => observer.observe(block));
    return () => observer.disconnect();
  }, [placed]);

  if (!activities || checks.length === 0) return null;
  const preview = activities.mode === "preview";
  const active = listVisible
    ? undefined
    : placed.find((check) => reached.has(check.id) && !dismissed.has(check.id) && !check.result);

  return (
    <>
      {active ? (
        <section
          aria-label="Check for understanding"
          className="fixed inset-x-[var(--space-3)] bottom-[var(--space-4)] z-40 mx-auto max-w-[36rem]"
        >
          <Card className="shadow-[var(--shadow-lg)]">
            <CardBody className="flex flex-col gap-[var(--space-3)]">
              <div className="flex items-center gap-[var(--space-2)]">
                <ListChecks size={16} aria-hidden="true" className="text-primary-text" />
                <span className="text-[length:var(--type-label)] font-semibold uppercase tracking-[var(--tracking-label)] text-text-muted">
                  Check for understanding
                </span>
                <PreviewNote show={preview} />
                <IconButton
                  size="sm"
                  className="ml-auto"
                  aria-label="Hide this check for now"
                  onClick={() => setDismissed((current) => new Set([...current, active.id]))}
                >
                  <X size={14} aria-hidden="true" />
                </IconButton>
              </div>
              <CheckBody check={active} preview={preview} headingId={`checkpoint-${active.id}`} />
            </CardBody>
          </Card>
        </section>
      ) : null}
      <section
        ref={listRef}
        aria-labelledby="reader-checks-title"
        className="mt-[var(--space-6)] flex flex-col gap-[var(--space-3)]"
      >
        <h2
          id="reader-checks-title"
          className="m-0 font-[family-name:var(--font-display)] text-[length:var(--type-section-title)] font-semibold text-text"
        >
          Checks for understanding
        </h2>
        {checks.map((check, index) => (
          <Card key={check.id}>
            <CardBody className="flex flex-col gap-[var(--space-2)]">
              <span className="text-[length:var(--type-label)] font-semibold text-text-muted">
                Check {index + 1} of {checks.length}
              </span>
              <CheckBody check={check} preview={preview} headingId={`check-${check.id}`} />
            </CardBody>
          </Card>
        ))}
      </section>
    </>
  );
}
