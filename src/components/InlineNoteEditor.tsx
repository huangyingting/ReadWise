"use client";

import { useState, useRef, useCallback } from "react";
import { Pencil, Check, X } from "lucide-react";
import { cn, focusRing } from "@/lib/cn";

interface Props {
  highlightId: string;
  initialNote: string | null;
  maxLength?: number;
}

export default function InlineNoteEditor({ highlightId, initialNote, maxLength = 2000 }: Props) {
  const [note, setNote] = useState(initialNote ?? "");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note);
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const startEdit = useCallback(() => {
    setDraft(note);
    setEditing(true);
    setTimeout(() => textareaRef.current?.focus(), 0);
  }, [note]);

  const cancel = useCallback(() => {
    setEditing(false);
    setDraft(note);
  }, [note]);

  const save = useCallback(async () => {
    const trimmed = draft.trim();
    setSaving(true);
    try {
      const res = await fetch(`/api/highlights/${highlightId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: trimmed || null }),
      });
      if (res.ok) {
        setNote(trimmed);
        setEditing(false);
      }
    } finally {
      setSaving(false);
    }
  }, [draft, highlightId]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") cancel();
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) save();
    },
    [cancel, save],
  );

  if (editing) {
    return (
      <div className="mt-[var(--space-2)]">
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          maxLength={maxLength}
          rows={3}
          placeholder="Add a note…"
          className={cn(
            "w-full resize-y rounded-[var(--radius-md)] border border-border bg-surface",
            "px-[var(--space-3)] py-[var(--space-2)] text-[length:var(--text-sm)] text-text",
            "placeholder:text-text-subtle",
            focusRing,
          )}
        />
        <div className="flex items-center gap-[var(--space-2)] mt-[var(--space-1)]">
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className={cn(
              "inline-flex items-center gap-[var(--space-1)] px-[var(--space-2)] py-[var(--space-1)]",
              "rounded-[var(--radius-sm)] text-[length:var(--text-xs)] font-semibold",
              "bg-primary text-on-primary disabled:opacity-50",
              focusRing,
            )}
          >
            <Check size={12} aria-hidden />
            Save
          </button>
          <button
            type="button"
            onClick={cancel}
            className={cn(
              "inline-flex items-center gap-[var(--space-1)] px-[var(--space-2)] py-[var(--space-1)]",
              "rounded-[var(--radius-sm)] text-[length:var(--text-xs)]",
              "text-text-subtle hover:text-text",
              focusRing,
            )}
          >
            <X size={12} aria-hidden />
            Cancel
          </button>
          <span className="ml-auto text-[length:var(--text-xs)] text-text-subtle">
            ⌘↵ to save · Esc to cancel
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-[var(--space-2)] flex items-start gap-[var(--space-2)] group/note">
      {note ? (
        <p className="flex-1 text-[length:var(--text-sm)] text-text-muted whitespace-pre-wrap">
          {note}
        </p>
      ) : (
        <span className="flex-1 text-[length:var(--text-sm)] text-text-subtle italic">
          Add a note…
        </span>
      )}
      <button
        type="button"
        onClick={startEdit}
        title="Edit note"
        aria-label="Edit note"
        className={cn(
          "shrink-0 opacity-0 group-hover/note:opacity-100 focus:opacity-100",
          "p-1 rounded-[var(--radius-sm)] text-text-subtle hover:text-text",
          "transition-opacity",
          focusRing,
        )}
      >
        <Pencil size={13} aria-hidden />
      </button>
    </div>
  );
}
