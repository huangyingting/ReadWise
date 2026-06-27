"use client";

import { useState, useRef, useCallback } from "react";
import { Pencil, Check, X } from "lucide-react";
import { patchJson } from "@/lib/client-fetch";
import { Button, IconButton, Textarea } from "@/components/ui";
import { submitMutation } from "@/lib/offline/sync-runtime";

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
      await patchJson(`/api/highlights/${highlightId}`, { note: trimmed || null });
      setNote(trimmed);
      setEditing(false);
    } catch {
      // Offline / network failure — queue the note edit and keep it locally so
      // the user's text is never lost (RW-042). Server uses last-write-wins.
      void submitMutation({
        type: "highlight.note",
        endpoint: `/api/highlights/${highlightId}`,
        method: "PATCH",
        body: { note: trimmed || null },
        dedupeKey: `hl-note:${highlightId}`,
      });
      setNote(trimmed);
      setEditing(false);
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
        <Textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          maxLength={maxLength}
          rows={3}
          placeholder="Add a note…"
          className="w-full resize-y text-[length:var(--text-sm)]"
        />
        <div className="flex items-center gap-[var(--space-2)] mt-[var(--space-1)]">
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={save}
            disabled={saving}
            leadingIcon={<Check size={12} aria-hidden />}
          >
            Save
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={cancel}
            leadingIcon={<X size={12} aria-hidden />}
          >
            Cancel
          </Button>
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
      <IconButton
        size="sm"
        onClick={startEdit}
        title="Edit note"
        aria-label="Edit note"
        className="shrink-0 opacity-0 group-hover/note:opacity-100 focus:opacity-100 text-text-subtle hover:text-text transition-opacity"
      >
        <Pencil size={13} aria-hidden />
      </IconButton>
    </div>
  );
}
