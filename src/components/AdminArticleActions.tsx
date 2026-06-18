"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Action = "delete" | "rebuild" | null;

export default function AdminArticleActions({
  articleId,
  redirectOnDelete,
}: {
  articleId: string;
  redirectOnDelete?: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState<Action>(null);
  const [busy, setBusy] = useState<Action>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function runDelete() {
    setBusy("delete");
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/articles/${articleId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        throw new Error(`Delete failed (${res.status})`);
      }
      setConfirming(null);
      if (redirectOnDelete) {
        router.push(redirectOnDelete);
      } else {
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBusy(null);
    }
  }

  async function runRebuild() {
    setBusy("rebuild");
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
      setConfirming(null);
      setMessage(
        `Rebuild queued — cleared ${total} cached item(s); AI content will regenerate on next read.`,
      );
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Rebuild failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="admin-actions">
      <div className="admin-actions-row">
        <button
          type="button"
          className="btn"
          disabled={busy !== null}
          onClick={() => {
            setMessage(null);
            setError(null);
            setConfirming(confirming === "rebuild" ? null : "rebuild");
          }}
        >
          Rebuild AI content
        </button>
        <button
          type="button"
          className="btn btn-danger"
          disabled={busy !== null}
          onClick={() => {
            setMessage(null);
            setError(null);
            setConfirming(confirming === "delete" ? null : "delete");
          }}
        >
          Delete
        </button>
      </div>

      {confirming === "rebuild" && (
        <div className="admin-confirm" role="alertdialog" aria-label="Confirm rebuild">
          <p style={{ margin: 0 }}>
            Clear cached translations, vocabulary, quiz, narration and tags for
            this article? They will be regenerated on the next read.
          </p>
          <div className="admin-actions-row">
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy === "rebuild"}
              onClick={runRebuild}
            >
              {busy === "rebuild" ? "Rebuilding…" : "Confirm rebuild"}
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy === "rebuild"}
              onClick={() => setConfirming(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {confirming === "delete" && (
        <div className="admin-confirm" role="alertdialog" aria-label="Confirm delete">
          <p style={{ margin: 0 }}>
            Permanently delete this article and all related AI content, tags and
            reader progress? This cannot be undone.
          </p>
          <div className="admin-actions-row">
            <button
              type="button"
              className="btn btn-danger"
              disabled={busy === "delete"}
              onClick={runDelete}
            >
              {busy === "delete" ? "Deleting…" : "Confirm delete"}
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy === "delete"}
              onClick={() => setConfirming(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {message && (
        <p className="muted" style={{ margin: 0 }}>
          {message}
        </p>
      )}
      {error && (
        <p className="admin-error" style={{ margin: 0 }}>
          {error}
        </p>
      )}
    </div>
  );
}
