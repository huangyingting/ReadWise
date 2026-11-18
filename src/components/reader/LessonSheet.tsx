"use client";

/**
 * "Apply to your lesson" sheet for educators (#1304):
 *  - Lesson scaffolds: before-reading hook, discussion questions, key terms
 *    (AI-generated and cached, or built from the text without AI).
 *  - Oral fluency practice: a deterministic 100/150/200-word passage with
 *    cumulative word counts, the WCPM/accuracy rubric, and a print link.
 *  - Poll & checks: the pre-reading poll and Checks for Understanding for one
 *    of the educator's assignments of this article, with class results.
 */

import { useCallback, useEffect, useState, type SubmitEvent } from "react";
import { X } from "lucide-react";
import { clientErrorMessage, deleteJson, getJson, postJson, putJson } from "@/lib/client-fetch";
import {
  FLUENCY_LENGTHS,
  FLUENCY_RUBRIC,
  extractFluencyPassage,
  type FluencyLength,
} from "@/lib/lesson/fluency";
import {
  Badge,
  Button,
  EmptyState,
  Field,
  IconButton,
  Input,
  PanelError,
  Select,
  Sheet,
  Spinner,
  Textarea,
  buttonVariants,
} from "@/components/ui";
import ConfirmAction from "@/components/ConfirmAction";
import { useClassAnnotations } from "./ReaderClassAnnotationsProvider";
import { getObservedBlocks } from "./useCurrentReadingBlock";
import { useReaderLevel } from "./ReaderLevelContext";
import { ORIGINAL_LEVEL, isReadingLevelKey, readingLevelLabel } from "@/lib/article-levels/levels";

type Scaffold = {
  hook: string;
  questions: string[];
  keyTerms: Array<{ term: string; definition: string | null; context: string | null }>;
  fallback: boolean;
};

type Activities = {
  poll: { id: string; question: string; options: string[]; distribution: number[]; voters: number } | null;
  checks: Array<{
    id: string;
    afterBlock: number;
    levelKey: string;
    question: string;
    options: string[];
    correctIndex: number;
    explanation: string | null;
    answered: number;
    correctCount: number;
  }>;
};

const sectionTitle = "m-0 font-[family-name:var(--font-display)] text-[length:var(--type-section-title-compact)] font-semibold text-text";
const muted = "m-0 text-[length:var(--type-ui)] text-text-muted";

function lines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function ScaffoldSection({ articleId }: { articleId: string }) {
  const [scaffold, setScaffold] = useState<Scaffold | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    postJson<Scaffold>(`/api/reader/${encodeURIComponent(articleId)}/lesson`, {})
      .then((data) => {
        if (active) setScaffold(data);
      })
      .catch((err) => {
        if (active) setError(clientErrorMessage(err, "Couldn’t load lesson scaffolds."));
      });
    return () => {
      active = false;
    };
  }, [articleId]);

  if (error) return <PanelError message={error} />;
  if (!scaffold) return <Spinner size="sm" label="Loading lesson scaffolds" />;
  return (
    <div className="flex flex-col gap-[var(--space-4)]">
      {scaffold.fallback ? <Badge variant="neutral">Built from the article text</Badge> : null}
      <section aria-labelledby="lesson-hook" className="flex flex-col gap-[var(--space-2)]">
        <h3 id="lesson-hook" className={sectionTitle}>
          Before-reading hook
        </h3>
        <p className="m-0 text-[length:var(--type-ui)] text-text">{scaffold.hook}</p>
      </section>
      <section aria-labelledby="lesson-questions" className="flex flex-col gap-[var(--space-2)]">
        <h3 id="lesson-questions" className={sectionTitle}>
          Discussion questions
        </h3>
        <ol className="m-0 flex list-decimal flex-col gap-[var(--space-1)] pl-[var(--space-5)] text-[length:var(--type-ui)] text-text">
          {scaffold.questions.map((question) => (
            <li key={question}>{question}</li>
          ))}
        </ol>
      </section>
      <section aria-labelledby="lesson-terms" className="flex flex-col gap-[var(--space-2)]">
        <h3 id="lesson-terms" className={sectionTitle}>
          Key terms
        </h3>
        {scaffold.keyTerms.length === 0 ? (
          <p className={muted}>No key terms found.</p>
        ) : (
          <dl className="m-0 flex flex-col gap-[var(--space-2)] text-[length:var(--type-ui)]">
            {scaffold.keyTerms.map((term) => (
              <div key={term.term}>
                <dt className="font-semibold text-text">{term.term}</dt>
                <dd className="m-0 text-text-muted">{term.definition ?? (term.context ? `“${term.context}”` : "")}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>
    </div>
  );
}

function FluencySection({ articleId, plainText }: { articleId: string; plainText: string }) {
  const [length, setLength] = useState<FluencyLength>(100);
  const passage = extractFluencyPassage(plainText, length);
  return (
    <div className="flex flex-col gap-[var(--space-3)]">
      <div role="group" aria-label="Passage length" className="flex flex-wrap gap-[var(--space-2)]">
        {FLUENCY_LENGTHS.map((option) => (
          <Button
            key={option}
            type="button"
            size="sm"
            variant={option === length ? "primary" : "outline"}
            aria-pressed={option === length}
            onClick={() => setLength(option)}
          >
            {option} words
          </Button>
        ))}
      </div>
      {passage.wordCount < length ? (
        <p className={muted}>This article has {passage.wordCount} words, so the passage is the whole text.</p>
      ) : null}
      <table aria-label={`${length}-word fluency passage`} className="w-full border-collapse text-[length:var(--type-ui)]">
        <tbody>
          {passage.lines.map((line) => (
            <tr key={line.cumulative} className="border-b border-border last:border-0">
              <td className="py-[var(--space-1)] pr-[var(--space-3)] text-text">{line.text}</td>
              <td className="py-[var(--space-1)] text-right tabular-nums text-text-muted">{line.cumulative}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex flex-col gap-[var(--space-1)] text-[length:var(--type-ui)] text-text">
        <p className="m-0">
          <strong>WCPM</strong> = words read in one minute − errors. <strong>Accuracy</strong> = (words read − errors) ÷
          words read.
        </p>
        <p className={muted}>
          {FLUENCY_RUBRIC.accuracy.map((band) => `${band.label} ${band.range}`).join(" · ")}
        </p>
      </div>
      <div>
        <a
          href={`/reader/${encodeURIComponent(articleId)}/print?mode=fluency&words=${length}`}
          target="_blank"
          rel="noopener noreferrer"
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          Print passage &amp; rubric
        </a>
      </div>
    </div>
  );
}

function blockOptions(): Array<{ index: number; label: string }> {
  const prose = typeof document === "undefined" ? null : document.querySelector<HTMLElement>(".word-lookup-prose");
  if (!prose) return [];
  return getObservedBlocks(prose).map((block, index) => {
    const text = (block.textContent ?? "").replace(/\s+/g, " ").trim();
    return { index, label: `${index + 1}. ${text.length > 48 ? `${text.slice(0, 47)}…` : text}` };
  });
}

function PollEditor({ assignmentId, poll, onSaved }: { assignmentId: string; poll: Activities["poll"]; onSaved: () => void }) {
  const [question, setQuestion] = useState(poll?.question ?? "");
  const [options, setOptions] = useState(poll?.options.join("\n") ?? "Agree\nDisagree\nNot sure");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const url = `/api/assignments/${encodeURIComponent(assignmentId)}/poll`;

  async function save(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await putJson(url, { question, options: lines(options) });
      onSaved();
    } catch (err) {
      setError(clientErrorMessage(err, "Couldn’t save the poll."));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-[var(--space-3)]">
      {poll && poll.voters > 0 ? (
        <p className={muted}>
          {poll.voters} {poll.voters === 1 ? "vote" : "votes"}:{" "}
          {poll.options.map((option, index) => `${option} ${poll.distribution[index] ?? 0}`).join(" · ")}
        </p>
      ) : null}
      <Field label="Poll question" hint="Non-graded. Students see the class results after voting.">
        <Input value={question} maxLength={500} onChange={(event) => setQuestion(event.target.value)} />
      </Field>
      <Field label="Poll options" hint="2–5 options, one per line. Saving changes clears existing votes.">
        <Textarea value={options} rows={3} onChange={(event) => setOptions(event.target.value)} />
      </Field>
      <div className="flex flex-wrap gap-[var(--space-2)]">
        <Button type="submit" size="sm" loading={pending} disabled={pending || !question.trim()}>
          Save poll
        </Button>
        {poll ? (
          <ConfirmAction
            triggerLabel="Remove poll"
            triggerVariant="danger-ghost"
            size="sm"
            confirmMessage="Remove the poll and its votes?"
            onConfirm={async () => {
              await deleteJson(url);
              onSaved();
            }}
          />
        ) : null}
      </div>
      {error ? <PanelError message={error} /> : null}
    </form>
  );
}

function CheckForm({ assignmentId, onSaved }: { assignmentId: string; onSaved: () => void }) {
  const level = useReaderLevel();
  const [blocks] = useState(blockOptions);
  const [afterBlock, setAfterBlock] = useState(String(Math.max(0, Math.floor(blocks.length / 2) - 1)));
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState("");
  const [correctIndex, setCorrectIndex] = useState("0");
  const [explanation, setExplanation] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const optionLines = lines(options);

  async function add(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await postJson(`/api/assignments/${encodeURIComponent(assignmentId)}/checks`, {
        afterBlock: Number(afterBlock),
        question,
        options: optionLines,
        correctIndex: Number(correctIndex),
        explanation: explanation || null,
        levelKey: level,
      });
      setQuestion("");
      setOptions("");
      setExplanation("");
      onSaved();
    } catch (err) {
      setError(clientErrorMessage(err, "Couldn’t add the check."));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={add} className="flex flex-col gap-[var(--space-3)]">
      <Field label="Show after" hint={level === ORIGINAL_LEVEL ? undefined : `Placed in the ${readingLevelLabel(level)} text you're reading.`}>
        <Select value={afterBlock} onChange={(event) => setAfterBlock(event.target.value)}>
          {blocks.map((block) => (
            <option key={block.index} value={String(block.index)}>
              {block.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Check question">
        <Input value={question} maxLength={500} onChange={(event) => setQuestion(event.target.value)} />
      </Field>
      <Field label="Answer choices" hint="2–4 choices, one per line.">
        <Textarea value={options} rows={3} onChange={(event) => setOptions(event.target.value)} />
      </Field>
      {optionLines.length >= 2 ? (
        <Field label="Correct answer">
          <Select value={correctIndex} onChange={(event) => setCorrectIndex(event.target.value)}>
            {optionLines.map((option, index) => (
              <option key={option} value={String(index)}>
                {option}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      <Field label="Explanation (optional)">
        <Input value={explanation} maxLength={600} onChange={(event) => setExplanation(event.target.value)} />
      </Field>
      <div>
        <Button type="submit" size="sm" loading={pending} disabled={pending || !question.trim() || optionLines.length < 2}>
          Add check
        </Button>
      </div>
      {error ? <PanelError message={error} /> : null}
    </form>
  );
}

function ActivitiesSection() {
  const { teaching } = useClassAnnotations();
  const [assignmentId, setAssignmentId] = useState(teaching[0]?.assignmentId ?? "");
  const [activities, setActivities] = useState<Activities | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const selected = assignmentId || teaching[0]?.assignmentId || "";

  const reload = useCallback(() => setVersion((current) => current + 1), []);

  useEffect(() => {
    if (!selected) return;
    let active = true;
    getJson<Activities>(`/api/assignments/${encodeURIComponent(selected)}/activities`)
      .then((data) => {
        if (active) {
          setActivities(data);
          setError(null);
        }
      })
      .catch((err) => {
        if (active) setError(clientErrorMessage(err, "Couldn’t load activities."));
      });
    return () => {
      active = false;
    };
  }, [selected, version]);

  if (teaching.length === 0) {
    return (
      <EmptyState
        title="Assign this article first"
        description="Polls and Checks for Understanding belong to an assignment. Assign the article to a class, then add them here."
        className="border-0 bg-transparent py-[var(--space-4)]"
      />
    );
  }

  return (
    <div className="flex flex-col gap-[var(--space-4)]">
      {teaching.length > 1 ? (
        <Field label="Assignment">
          <Select value={selected} onChange={(event) => setAssignmentId(event.target.value)}>
            {teaching.map((assignment) => (
              <option key={assignment.assignmentId} value={assignment.assignmentId}>
                {assignment.classroomName}
              </option>
            ))}
          </Select>
        </Field>
      ) : (
        <p className={muted}>For {teaching[0].classroomName}</p>
      )}
      {error ? <PanelError message={error} /> : null}
      {activities ? (
        <>
          <section aria-labelledby="lesson-poll" className="flex flex-col gap-[var(--space-2)]">
            <h3 id="lesson-poll" className={sectionTitle}>
              Pre-reading poll
            </h3>
            <PollEditor key={`${selected}-${activities.poll?.id ?? "new"}`} assignmentId={selected} poll={activities.poll} onSaved={reload} />
          </section>
          <section aria-labelledby="lesson-checks" className="flex flex-col gap-[var(--space-3)]">
            <h3 id="lesson-checks" className={sectionTitle}>
              Checks for understanding
            </h3>
            {activities.checks.length === 0 ? <p className={muted}>No checks yet.</p> : null}
            <ul aria-label="Checks for understanding" className="m-0 flex list-none flex-col gap-[var(--space-2)] p-0">
              {activities.checks.map((check) => (
                <li key={check.id} className="flex items-start gap-[var(--space-2)] border-b border-border pb-[var(--space-2)]">
                  <div className="flex min-w-0 flex-1 flex-col gap-[var(--space-1)] text-[length:var(--type-ui)]">
                    <span className="font-semibold text-text">{check.question}</span>
                    <span className="text-text-muted">
                      After block {check.afterBlock + 1}
                      {check.levelKey !== ORIGINAL_LEVEL && isReadingLevelKey(check.levelKey)
                        ? ` (${readingLevelLabel(check.levelKey)})`
                        : ""}{" "}
                      · answer: {check.options[check.correctIndex]} ·{" "}
                      {check.answered === 0 ? "no answers yet" : `${check.correctCount}/${check.answered} correct`}
                    </span>
                  </div>
                  <ConfirmAction
                    triggerLabel="Remove"
                    triggerAriaLabel={`Remove check ${check.question}`}
                    triggerVariant="danger-ghost"
                    size="sm"
                    confirmMessage="Remove this check and its answers?"
                    onConfirm={async () => {
                      await deleteJson(`/api/assignment-checks/${encodeURIComponent(check.id)}`);
                      reload();
                    }}
                  />
                </li>
              ))}
            </ul>
            <CheckForm key={`${selected}-${activities.checks.length}`} assignmentId={selected} onSaved={reload} />
          </section>
        </>
      ) : (
        <Spinner size="sm" label="Loading activities" />
      )}
    </div>
  );
}

export default function LessonSheet({
  open,
  onClose,
  articleId,
  articleTitle,
  plainText,
}: {
  open: boolean;
  onClose: () => void;
  articleId: string;
  articleTitle: string;
  plainText: string;
}) {
  const [tab, setTab] = useState<"scaffolds" | "fluency" | "activities">("scaffolds");
  const tabs = [
    { id: "scaffolds", label: "Lesson ideas" },
    { id: "fluency", label: "Oral fluency" },
    { id: "activities", label: "Poll & checks" },
  ] as const;

  return (
    <Sheet open={open} onClose={onClose} side="right" label="Apply to your lesson">
      <div className="flex items-center justify-between gap-[var(--space-4)] border-b border-border px-[var(--space-5)] py-[var(--space-4)]">
        <div className="min-w-0">
          <h2 className="m-0 font-[family-name:var(--font-display)] text-[length:var(--type-section-title)] font-semibold text-text">
            Apply to your lesson
          </h2>
          <p className="m-0 truncate text-[length:var(--type-ui)] text-text-muted">{articleTitle}</p>
        </div>
        <IconButton aria-label="Close lesson tools" onClick={onClose}>
          <X size={18} aria-hidden="true" />
        </IconButton>
      </div>
      <div className="flex flex-wrap gap-[var(--space-2)] border-b border-border px-[var(--space-5)] py-[var(--space-3)]" role="group" aria-label="Lesson tools">
        {tabs.map((option) => (
          <Button
            key={option.id}
            type="button"
            size="sm"
            variant={tab === option.id ? "primary" : "ghost"}
            aria-pressed={tab === option.id}
            onClick={() => setTab(option.id)}
          >
            {option.label}
          </Button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-[var(--space-5)] py-[var(--space-4)]">
        {open && tab === "scaffolds" ? <ScaffoldSection articleId={articleId} /> : null}
        {open && tab === "fluency" ? <FluencySection articleId={articleId} plainText={plainText} /> : null}
        {open && tab === "activities" ? <ActivitiesSection /> : null}
      </div>
    </Sheet>
  );
}
