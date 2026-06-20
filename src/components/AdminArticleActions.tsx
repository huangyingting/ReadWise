"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ConfirmAction from "@/components/ConfirmAction";

export default function AdminArticleActions({
  articleId,
  redirectOnDelete,
}: {
  articleId: string;
  redirectOnDelete?: string;
}) {
  const router = useRouter();
  const [busyRebuild, setBusyRebuild] = useState(false);
  const [busyDelete, setBusyDelete] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Only one confirm panel open at a time
  const [openPanel, setOpenPanel] = useState<"rebuild" | "delete" | null>(null);

  async function runRebuild() {
    setBusyRebuild(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/articles/${articleId}/rebuild`, {
        method: "POST",
      });
      if (!res.ok) {
        throw new Error(`Rebuild failed (${res.status})`);
      }
      const data = (await res.json()) as {
        cleared?: Record<string, number>;
      };
      const total = data.cleared
        ? Object.values(data.cleared).reduce((sum, n) => sum + n, 0)
        : 0;
      setMessage(
        `Rebuild queued — cleared ${total} cached item(s); AI content will regenerate on next read.`,
      );
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Rebuild failed");
    } finally {
      setBusyRebuild(false);
    }
  }

  async function runDelete() {
    setBusyDelete(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/articles/${articleId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        throw new Error(`Delete failed (${res.status})`);
      }
      if (redirectOnDelete) {
        router.push(redirectOnDelete);
      } else {
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBusyDelete(false);
    }
  }

  return (
    <div className="admin-actions">
      <div className="admin-actions-row">
        <ConfirmAction
          triggerLabel="Rebuild AI content"
          triggerVariant="secondary"
          confirmVariant="primary"
          confirmLabel="Confirm rebuild"
          confirmMessage="Clear cached translations, vocabulary, quiz, narration and tags for this article? They will be regenerated on the next read."
          onConfirm={runRebuild}
          loading={busyRebuild}
          disabled={busyDelete}
          open={openPanel === "rebuild"}
          onOpenChange={(v) => setOpenPanel(v ? "rebuild" : null)}
        />
        <ConfirmAction
          triggerLabel="Delete"
          triggerVariant="danger-ghost"
          confirmVariant="danger"
          confirmLabel="Confirm delete"
          confirmMessage="Permanently delete this article and all related AI content, tags and reader progress? This cannot be undone."
          onConfirm={runDelete}
          loading={busyDelete}
          disabled={busyRebuild}
          open={openPanel === "delete"}
          onOpenChange={(v) => setOpenPanel(v ? "delete" : null)}
        />
      </div>

      {message && (
        <p className="muted" style={{ margin: 0 }}>
          {message}
        </p>
      )}
      {error && (
        <p
          className="text-danger-text text-[length:var(--text-sm)]"
          style={{ margin: 0 }}
        >
          {error}
        </p>
      )}
    </div>
  );
}
