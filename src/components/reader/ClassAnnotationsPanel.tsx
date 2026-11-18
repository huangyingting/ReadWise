"use client";

/**
 * Classroom annotations in the reader Notes tab (#1307).
 *
 *  - ClassPromptsSection: the teacher's guided prompts in document order.
 *    Teachers edit or delete prompts for classes they manage; learners reply
 *    and see (and can withdraw) what they've shared.
 *  - HighlightClassAction: per-highlight action. Teachers turn one of their
 *    highlights into a class prompt; learners explicitly share a highlight
 *    as evidence. Nothing about a personal highlight (including its note) is
 *    shared unless the learner submits it here.
 */

import { useReaderLevel } from "./ReaderLevelContext";
import { isReadingLevelKey, readingLevelLabel } from "@/lib/article-levels/levels";
import { useState, type SubmitEvent } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { clientErrorMessage } from "@/lib/client-fetch";
import {
  ANNOTATION_PROMPT_MAX_LENGTH,
  ANNOTATION_RESPONSE_MAX_LENGTH,
} from "@/lib/classroom/annotation-limits";
import { Badge, Button, Field, IconButton, PanelError, Select, Textarea } from "@/components/ui";
import ConfirmAction from "@/components/ConfirmAction";
import type { Highlight } from "@/components/ReaderHighlightsProvider";
import {
  useClassAnnotations,
  type ClassAssignment,
  type ClassGuide,
  type ClassResponse,
} from "./ReaderClassAnnotationsProvider";

const NO_PROMPT = "";

/** Scroll to and briefly outline a guided prompt's passage in the prose. */
function flashGuide(guideId: string): boolean {
  const marks = Array.from(document.querySelectorAll<HTMLElement>(`mark.rw-guide[data-guide-id="${guideId}"]`));
  if (marks.length === 0) return false;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  marks[0].scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "center" });
  marks.forEach((mark) => mark.classList.add("rw-guide-flash"));
  setTimeout(() => marks.forEach((mark) => mark.classList.remove("rw-guide-flash")), 1200);
  return true;
}

function ClassPicker({
  label,
  assignments,
  value,
  onChange,
}: {
  label: string;
  assignments: ClassAssignment[];
  value: string;
  onChange: (value: string) => void;
}) {
  if (assignments.length < 2) return null;
  return (
    <Field label={label}>
      <Select value={value} onChange={(event) => onChange(event.target.value)}>
        {assignments.map((assignment) => (
          <option key={assignment.assignmentId} value={assignment.assignmentId}>
            {assignment.classroomName}
          </option>
        ))}
      </Select>
    </Field>
  );
}

function ResponseItem({ response, onDelete }: { response: ClassResponse; onDelete: () => Promise<void> }) {
  const [deleting, setDeleting] = useState(false);
  return (
    <li className="flex items-start gap-[var(--space-2)]">
      <div className="flex min-w-0 flex-1 flex-col gap-[var(--space-1)]">
        {response.quote ? <p className="rw-note-row-quote m-0">&ldquo;{response.quote}&rdquo;</p> : null}
        {response.body ? <p className="rw-note-row-note">{response.body}</p> : null}
      </div>
      <ConfirmAction
        triggerLabel=""
        triggerIcon={<Trash2 size={14} aria-hidden="true" />}
        triggerAriaLabel="Withdraw from teacher"
        triggerVariant="danger-ghost"
        size="sm"
        confirmMessage="Withdraw this from your teacher?"
        confirmLabel="Withdraw"
        loading={deleting}
        className="contents"
        onConfirm={async () => {
          setDeleting(true);
          try {
            await onDelete();
          } finally {
            setDeleting(false);
          }
        }}
      />
    </li>
  );
}

function ReplyForm({ guide }: { guide: ClassGuide }) {
  const { submitResponse } = useClassAnnotations();
  const [body, setBody] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!body.trim()) return;
    setPending(true);
    setError(null);
    try {
      await submitResponse(guide.assignmentId, { annotationId: guide.id, body });
      setBody("");
    } catch (err) {
      setError(clientErrorMessage(err, "Couldn’t send your reply."));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-[var(--space-2)]">
      <Field label={`Your reply to prompt ${guide.number}`} hint="Only you and your teacher can see replies.">
        <Textarea
          value={body}
          rows={3}
          maxLength={ANNOTATION_RESPONSE_MAX_LENGTH}
          onChange={(event) => setBody(event.target.value)}
        />
      </Field>
      <div>
        <Button type="submit" size="sm" loading={pending} disabled={pending || !body.trim()}>
          Send reply
        </Button>
      </div>
      {error ? <PanelError message={error} /> : null}
    </form>
  );
}

function GuideCard({
  guide,
  showClass,
  isLearner,
  replies,
}: {
  guide: ClassGuide;
  showClass: boolean;
  isLearner: boolean;
  replies: ClassResponse[];
}) {
  const { updateGuide, deleteGuide, deleteResponse } = useClassAnnotations();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(guide.prompt);
  const [pending, setPending] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const titleId = `rw-guide-${guide.id}`;
  // Prompts anchored to another reading level (#1303) are listed but not painted.
  const onThisLevel = guide.levelKey === useReaderLevel();

  async function save(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await updateGuide(guide.id, draft);
      setEditing(false);
    } catch (err) {
      setError(clientErrorMessage(err, "Couldn’t save the prompt."));
    } finally {
      setPending(false);
    }
  }

  return (
    <article
      aria-labelledby={titleId}
      className="flex flex-col gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[color:var(--reading-border,var(--border))] p-[var(--space-3)]"
    >
      <div className="flex flex-wrap items-center gap-[var(--space-2)]">
        <h4 id={titleId} className="m-0 text-[length:var(--type-ui)] font-semibold text-[color:var(--reading-text,var(--text))]">
          Prompt {guide.number}
        </h4>
        {showClass ? <Badge variant="neutral">{guide.classroomName}</Badge> : null}
        {guide.canEdit && !editing ? (
          <span className="ml-auto flex items-center">
            <IconButton
              size="sm"
              context="reading"
              aria-label={`Edit prompt ${guide.number}`}
              onClick={() => {
                setDraft(guide.prompt);
                setEditing(true);
              }}
            >
              <Pencil size={14} aria-hidden="true" />
            </IconButton>
            <ConfirmAction
              triggerLabel=""
              triggerIcon={<Trash2 size={14} aria-hidden="true" />}
              triggerAriaLabel={`Delete prompt ${guide.number}`}
              triggerVariant="danger-ghost"
              size="sm"
              confirmMessage="Delete this prompt and students’ replies to it?"
              loading={deleting}
              className="contents"
              onConfirm={async () => {
                setDeleting(true);
                try {
                  await deleteGuide(guide.id);
                } finally {
                  setDeleting(false);
                }
              }}
            />
          </span>
        ) : null}
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="rw-note-row-quote"
        aria-label={`Go to passage for prompt ${guide.number}`}
        disabled={!onThisLevel}
        onClick={() => setMissing(!flashGuide(guide.id))}
      >
        &ldquo;{guide.quote}&rdquo;
      </Button>
      {!onThisLevel ? (
        <p className="rw-note-row-note">
          This passage is in the {isReadingLevelKey(guide.levelKey) ? readingLevelLabel(guide.levelKey) : guide.levelKey} text.
        </p>
      ) : null}
      {missing ? <p className="rw-note-row-orphaned m-0">Not found in current text</p> : null}
      {editing ? (
        <form onSubmit={save} className="flex flex-col gap-[var(--space-2)]">
          <Field label="Prompt">
            <Textarea
              value={draft}
              rows={3}
              maxLength={ANNOTATION_PROMPT_MAX_LENGTH}
              onChange={(event) => setDraft(event.target.value)}
            />
          </Field>
          <div className="flex gap-[var(--space-2)]">
            <Button type="submit" size="sm" loading={pending} disabled={pending || !draft.trim()}>
              Save prompt
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <p className="m-0 whitespace-pre-line text-[length:var(--type-ui)] text-[color:var(--reading-text,var(--text))]">
          {guide.prompt}
        </p>
      )}
      {error ? <PanelError message={error} /> : null}
      {isLearner ? (
        <>
          {replies.length > 0 ? (
            <ul aria-label={`Your replies to prompt ${guide.number}`} className="m-0 flex list-none flex-col gap-[var(--space-2)] p-0">
              {replies.map((reply) => (
                <ResponseItem key={reply.id} response={reply} onDelete={() => deleteResponse(reply.id)} />
              ))}
            </ul>
          ) : null}
          <ReplyForm guide={guide} />
        </>
      ) : null}
    </article>
  );
}

export function ClassPromptsSection() {
  const { loaded, teaching, learning, guides, responses, deleteResponse } = useClassAnnotations();
  if (!loaded || (guides.length === 0 && teaching.length === 0 && learning.length === 0)) return null;

  const learnerAssignments = new Set(learning.map((entry) => entry.assignmentId));
  const showClass = new Set([...guides.map((guide) => guide.assignmentId), ...teaching.map((t) => t.assignmentId)]).size > 1;
  const evidence = responses.filter((response) => response.annotationId === null);

  return (
    <section aria-labelledby="rw-class-prompts-title" className="mb-[var(--space-5)] flex flex-col gap-[var(--space-3)]">
      <div className="rw-notes-panel-header">
        <h3 id="rw-class-prompts-title" className="rw-notes-panel-title">
          Class prompts
        </h3>
        <Badge variant="primary">{guides.length}</Badge>
      </div>
      {guides.length === 0 ? (
        <p className="rw-note-row-note">
          {teaching.length > 0
            ? "Highlight a passage, then choose “Add class prompt” on it below to guide your students."
            : "Your teacher hasn’t added prompts to this article yet."}
        </p>
      ) : (
        guides.map((guide) => (
          <GuideCard
            key={guide.id}
            guide={guide}
            showClass={showClass}
            isLearner={learnerAssignments.has(guide.assignmentId)}
            replies={responses.filter((response) => response.annotationId === guide.id)}
          />
        ))
      )}
      {learning.length > 0 ? (
        <div className="flex flex-col gap-[var(--space-2)]">
          <h4 className="m-0 text-[length:var(--type-ui)] font-semibold text-[color:var(--reading-text,var(--text))]">
            Evidence shared with your teacher
          </h4>
          {evidence.length === 0 ? (
            <p className="rw-note-row-note">
              Use “Share as evidence” on one of your highlights below. Your highlights stay private until you share them.
            </p>
          ) : (
            <ul aria-label="Evidence shared with your teacher" className="m-0 flex list-none flex-col gap-[var(--space-2)] p-0">
              {evidence.map((item) => (
                <ResponseItem key={item.id} response={item} onDelete={() => deleteResponse(item.id)} />
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  );
}

function anchorOf(highlight: Highlight) {
  const { quote, startOffset, endOffset, prefix, suffix } = highlight;
  return { quote, startOffset, endOffset, prefix, suffix };
}

function AddPromptForm({ highlight, onDone }: { highlight: Highlight; onDone: () => void }) {
  const { teaching, createGuide } = useClassAnnotations();
  const [assignmentId, setAssignmentId] = useState(teaching[0]?.assignmentId ?? "");
  const [prompt, setPrompt] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await createGuide(assignmentId, anchorOf(highlight), prompt);
      onDone();
    } catch (err) {
      setError(clientErrorMessage(err, "Couldn’t add the prompt."));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-[var(--space-2)]">
      <ClassPicker label="Class" assignments={teaching} value={assignmentId} onChange={setAssignmentId} />
      <Field label="Prompt for students" hint="Students in the class see it on this passage.">
        <Textarea
          value={prompt}
          rows={3}
          maxLength={ANNOTATION_PROMPT_MAX_LENGTH}
          onChange={(event) => setPrompt(event.target.value)}
        />
      </Field>
      <div className="flex gap-[var(--space-2)]">
        <Button type="submit" size="sm" loading={pending} disabled={pending || !prompt.trim()}>
          Add prompt
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
      {error ? <PanelError message={error} /> : null}
    </form>
  );
}

function ShareEvidenceForm({ highlight, onDone }: { highlight: Highlight; onDone: (shared: boolean) => void }) {
  const { learning, guides, submitResponse } = useClassAnnotations();
  const [assignmentId, setAssignmentId] = useState(learning[0]?.assignmentId ?? "");
  const [annotationId, setAnnotationId] = useState(NO_PROMPT);
  const [body, setBody] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const prompts = guides.filter((guide) => guide.assignmentId === assignmentId);

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await submitResponse(assignmentId, { annotationId: annotationId || null, anchor: anchorOf(highlight), body });
      onDone(true);
    } catch (err) {
      setError(clientErrorMessage(err, "Couldn’t share this highlight."));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-[var(--space-2)]">
      <ClassPicker
        label="Class"
        assignments={learning}
        value={assignmentId}
        onChange={(value) => {
          setAssignmentId(value);
          setAnnotationId(NO_PROMPT);
        }}
      />
      {prompts.length > 0 ? (
        <Field label="Responds to">
          <Select value={annotationId} onChange={(event) => setAnnotationId(event.target.value)}>
            <option value={NO_PROMPT}>No specific prompt</option>
            {prompts.map((guide) => (
              <option key={guide.id} value={guide.id}>
                Prompt {guide.number}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      <Field label="Why this is evidence (optional)" hint="Your teacher sees this passage and explanation, not your private note.">
        <Textarea
          value={body}
          rows={3}
          maxLength={ANNOTATION_RESPONSE_MAX_LENGTH}
          onChange={(event) => setBody(event.target.value)}
        />
      </Field>
      <div className="flex gap-[var(--space-2)]">
        <Button type="submit" size="sm" loading={pending} disabled={pending}>
          Share with teacher
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => onDone(false)}>
          Cancel
        </Button>
      </div>
      {error ? <PanelError message={error} /> : null}
    </form>
  );
}

/** "Add class prompt" (teachers) or "Share as evidence" (learners) for one highlight. */
export function HighlightClassAction({ highlight }: { highlight: Highlight }) {
  const { teaching, learning } = useClassAnnotations();
  const [open, setOpen] = useState(false);
  const [shared, setShared] = useState(false);
  if (highlight.id.startsWith("optimistic-")) return null;
  const mode = teaching.length > 0 ? "teach" : learning.length > 0 ? "learn" : null;
  if (!mode) return null;

  if (open) {
    return mode === "teach" ? (
      <AddPromptForm highlight={highlight} onDone={() => setOpen(false)} />
    ) : (
      <ShareEvidenceForm
        highlight={highlight}
        onDone={(didShare) => {
          setOpen(false);
          setShared(didShare);
        }}
      />
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-[var(--space-2)]">
      <Button
        variant="ghost"
        size="sm"
        className="rw-note-row-add-note"
        onClick={() => {
          setShared(false);
          setOpen(true);
        }}
      >
        {mode === "teach" ? "Add class prompt" : "Share as evidence"}
      </Button>
      {shared ? (
        <span role="status" className="text-[length:var(--type-label)] text-[color:var(--reading-text-muted,var(--text-muted))]">
          Shared with your teacher.
        </span>
      ) : null}
    </div>
  );
}
