"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Field } from "@/components/ui/Field";

export type TakedownStateOption = { value: string; label: string };

export type AdminArticleTakedownProps = {
  articleId: string;
  currentState: string;
  stateOptions: TakedownStateOption[];
  currentRightsNote: string;
};

/**
 * Rights / takedown control (RW-047) on the admin article detail page. Applying
 * any non-active state forces the article to DRAFT so it leaves public feeds and
 * records a review-history row.
 */
export default function AdminArticleTakedown({
  articleId,
  currentState,
  stateOptions,
  currentRightsNote,
}: AdminArticleTakedownProps) {
  const router = useRouter();
  const [state, setState] = useState(currentState);
  const [note, setNote] = useState("");
  const [rightsNote, setRightsNote] = useState(currentRightsNote);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const willUnpublish = state !== "active" && state !== currentState;

  async function apply() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/articles/${articleId}/takedown`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          state,
          note: note.trim() || undefined,
          rightsNote: rightsNote.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? `Takedown failed (${res.status})`);
      }
      setNote("");
      setSavedAt(Date.now());
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Takedown failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-[var(--space-4)]">
        <Field label="Rights state">
          <Select value={state} onChange={(e) => setState(e.target.value)} selectSize="md">
            {stateOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Rights note" hint="Licensing / usage note kept with the article.">
          <Input
            value={rightsNote}
            onChange={(e) => setRightsNote(e.target.value)}
            inputSize="md"
            placeholder="e.g. removed at publisher request"
          />
        </Field>
      </div>

      <Field label="Action note (optional)">
        <Input value={note} onChange={(e) => setNote(e.target.value)} inputSize="md" />
      </Field>

      {willUnpublish && (
        <p className="text-warning-text text-[length:var(--text-sm)]" style={{ margin: 0 }}>
          This will unpublish the article and remove it from public feeds.
        </p>
      )}

      <div className="flex items-center gap-[var(--space-3)]">
        <Button
          variant={willUnpublish ? "danger" : "primary"}
          size="md"
          onClick={apply}
          disabled={busy}
          className="w-auto"
        >
          {busy ? "Applying…" : "Apply"}
        </Button>
        {savedAt && !error && (
          <span className="text-success-text text-[length:var(--text-sm)]">Applied.</span>
        )}
      </div>

      {error && (
        <p className="text-danger-text text-[length:var(--text-sm)]" style={{ margin: 0 }}>
          {error}
        </p>
      )}
    </div>
  );
}
