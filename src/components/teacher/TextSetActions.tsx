"use client";

/**
 * Text Set actions (#1308): assign to classrooms (sheet with classroom
 * toggles and an optional due date), duplicate into a private copy, and
 * delete (editors only).
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, Send, X } from "lucide-react";
import ConfirmAction from "@/components/ConfirmAction";
import { clientErrorMessage, deleteJson, postJson } from "@/lib/client-fetch";
import { Button, Field, IconButton, Input, PanelError, Sheet } from "@/components/ui";

type AssignResponse = { classrooms: Array<{ classroomId: string; created: number; failed: number }> };

interface TextSetActionsProps {
  textSetId: string;
  canEdit: boolean;
  /** Active classrooms in the set's org that the teacher manages. */
  classrooms: Array<{ id: string; name: string }>;
}

export default function TextSetActions({ textSetId, canEdit, classrooms }: TextSetActionsProps) {
  const router = useRouter();
  const base = `/api/text-sets/${encodeURIComponent(textSetId)}`;
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [dueDate, setDueDate] = useState("");
  const [pending, setPending] = useState<"assign" | "duplicate" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function toggle(id: string) {
    setSelected((current) => (current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]));
  }

  async function assign() {
    setPending("assign");
    setError(null);
    try {
      const result = await postJson<AssignResponse>(`${base}/assign`, {
        classroomIds: selected,
        ...(dueDate ? { dueDate } : {}),
      });
      const created = result.classrooms.reduce((total, row) => total + row.created, 0);
      const failed = result.classrooms.reduce((total, row) => total + row.failed, 0);
      setMessage(
        `Assigned ${created} ${created === 1 ? "reading" : "readings"} to ${result.classrooms.length} ${
          result.classrooms.length === 1 ? "class" : "classes"
        }${failed > 0 ? ` (${failed} couldn’t be assigned)` : ""}.`,
      );
      setOpen(false);
      setSelected([]);
    } catch (err) {
      setError(clientErrorMessage(err, "Couldn’t assign the text set."));
    } finally {
      setPending(null);
    }
  }

  async function duplicate() {
    setPending("duplicate");
    setError(null);
    try {
      const copy = await postJson<{ id: string }>(`${base}/duplicate`, {});
      router.push(`/teacher/text-sets/${encodeURIComponent(copy.id)}`);
    } catch (err) {
      setError(clientErrorMessage(err, "Couldn’t duplicate the text set."));
      setPending(null);
    }
  }

  async function remove() {
    await deleteJson(base);
    router.push("/teacher/text-sets");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-[var(--space-3)]">
      <div className="flex flex-wrap items-center gap-[var(--space-2)]">
        <Button
          type="button"
          size="sm"
          leadingIcon={<Send size={14} aria-hidden />}
          disabled={classrooms.length === 0}
          onClick={() => setOpen(true)}
        >
          Assign to classes
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          loading={pending === "duplicate"}
          leadingIcon={<Copy size={14} aria-hidden />}
          onClick={() => void duplicate()}
        >
          Duplicate
        </Button>
        {canEdit ? (
          <ConfirmAction
            triggerLabel="Delete"
            triggerAriaLabel="Delete text set"
            triggerVariant="danger-ghost"
            confirmVariant="danger"
            confirmLabel="Delete text set"
            confirmMessage="Assignments already made from this set stay with your classes."
            onConfirm={remove}
          />
        ) : null}
      </div>
      {classrooms.length === 0 ? (
        <p className="m-0 text-[length:var(--type-label)] text-text-muted">
          Create a classroom in this organization to assign the set.
        </p>
      ) : null}
      {message ? (
        <p role="status" className="m-0 text-[length:var(--type-ui)] text-text-muted">
          {message}
        </p>
      ) : null}
      {error ? <PanelError message={error} /> : null}

      <Sheet open={open} onClose={() => setOpen(false)} side="right" label="Assign text set">
        <div className="flex items-center justify-between gap-[var(--space-4)] border-b border-border px-[var(--space-5)] py-[var(--space-4)]">
          <h2 className="m-0 text-[length:var(--type-section-title)] font-semibold text-text">Assign text set</h2>
          <IconButton
            aria-label="Close assign form"
            className="min-h-[44px] min-w-[44px] sm:min-h-8 sm:min-w-8"
            onClick={() => setOpen(false)}
          >
            <X size={18} aria-hidden />
          </IconButton>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-[var(--space-4)] overflow-y-auto px-[var(--space-5)] py-[var(--space-4)]">
          <div role="group" aria-label="Classes" className="flex flex-col gap-[var(--space-2)]">
            <span className="text-[length:var(--type-ui)] font-medium text-text">Classes</span>
            {classrooms.map((classroom) => (
              <Button
                key={classroom.id}
                type="button"
                size="sm"
                variant={selected.includes(classroom.id) ? "secondary" : "outline"}
                aria-pressed={selected.includes(classroom.id)}
                className="justify-start"
                onClick={() => toggle(classroom.id)}
              >
                {classroom.name}
              </Button>
            ))}
          </div>
          <Field label="Due date (optional)">
            <Input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
          </Field>
          <Button
            type="button"
            loading={pending === "assign"}
            disabled={selected.length === 0 || pending !== null}
            onClick={() => void assign()}
          >
            Assign {selected.length > 0 ? `to ${selected.length} ${selected.length === 1 ? "class" : "classes"}` : ""}
          </Button>
          {error ? <PanelError message={error} /> : null}
        </div>
      </Sheet>
    </div>
  );
}
