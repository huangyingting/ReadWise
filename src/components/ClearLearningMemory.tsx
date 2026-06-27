"use client";

import { useState } from "react";
import { deleteJson } from "@/lib/client-fetch";
import ConfirmAction from "@/components/ConfirmAction";

/**
 * "Clear learning memory" control (#810).
 *
 * Hard-deletes the user's privacy-safe `LearnerCoachMemory` rows via
 * `DELETE /api/coach-memory`. Underlying `SkillMastery` is untouched, so memory
 * simply rebuilds from future activity. Provides confirm, loading, and
 * success/error states via design-system primitives.
 */
export default function ClearLearningMemory() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleClear() {
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      await deleteJson("/api/coach-memory");
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not clear learning memory");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-[var(--space-2)]">
      <p className="text-text text-[length:var(--text-sm)] font-medium m-0">
        Clear learning memory
      </p>
      <p className="text-text-muted text-[length:var(--text-sm)] m-0">
        Erase the structured weakness summaries the Tutor and Study Plan use to
        personalise your coaching. This does not affect your reading progress,
        saved words, or skill mastery — memory simply rebuilds as you keep
        learning.
      </p>

      {error && (
        <p className="text-danger-text text-[length:var(--text-sm)] m-0" role="alert">
          {error}
        </p>
      )}
      {done && !error && (
        <p className="text-text-muted text-[length:var(--text-sm)] m-0" role="status">
          Learning memory cleared.
        </p>
      )}

      <div>
        <ConfirmAction
          triggerLabel="Clear learning memory"
          triggerVariant="outline"
          size="sm"
          confirmMessage={
            <span>
              Clear your learning memory? The Tutor and Study Plan will start
              fresh from your future activity.
            </span>
          }
          confirmLabel="Yes, clear it"
          cancelLabel="Cancel"
          confirmVariant="danger"
          onConfirm={handleClear}
          loading={busy}
        />
      </div>
    </div>
  );
}
