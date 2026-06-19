"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ConfirmAction from "@/components/ConfirmAction";

export default function AdminTagActions({
  tagId,
  tagName,
}: {
  tagId: string;
  tagName: string;
}) {
  const router = useRouter();
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
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <ConfirmAction
        triggerLabel="Delete"
        triggerVariant="danger"
        confirmVariant="danger"
        confirmLabel="Confirm delete"
        confirmMessage={
          <>
            Delete the tag &quot;{tagName}&quot;? It will be removed from every
            article that carries it. This cannot be undone.
          </>
        }
        onConfirm={runDelete}
        loading={busy}
      />
      {error && (
        <p
          className="text-danger-text text-[length:var(--text-sm)]"
          style={{ margin: 0 }}
        >
          {error}
        </p>
      )}
    </>
  );
}
