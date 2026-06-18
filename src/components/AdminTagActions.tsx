"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function AdminTagActions({
  tagId,
  tagName,
}: {
  tagId: string;
  tagName: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runDelete() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/tags/${tagId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(data?.error ?? `Delete failed (${res.status})`);
      }
      setConfirming(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-actions">
      <div className="admin-actions-row">
        <button
          type="button"
          className="btn btn-danger"
          disabled={busy}
          onClick={() => {
            setError(null);
            setConfirming((v) => !v);
          }}
        >
          Delete
        </button>
      </div>

      {confirming && (
        <div
          className="admin-confirm"
          role="alertdialog"
          aria-label="Confirm delete tag"
        >
          <p style={{ margin: 0 }}>
            Delete the tag “{tagName}”? It will be removed from every article that
            carries it. This cannot be undone.
          </p>
          <div className="admin-actions-row">
            <button
              type="button"
              className="btn btn-danger"
              disabled={busy}
              onClick={runDelete}
            >
              {busy ? "Deleting…" : "Confirm delete"}
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => setConfirming(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="admin-error" style={{ margin: 0 }}>
          {error}
        </p>
      )}
    </div>
  );
}
