"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";

/**
 * Syncs `ContentSource` rows from the code provider registry (RW-046). Inserts
 * any providers missing a row and refreshes display metadata. Audited.
 */
export default function AdminSourceSync() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function sync() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/sources/sync", { method: "POST" });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? `Sync failed (${res.status})`);
      }
      const data = (await res.json()) as { created: number; updated: number };
      setMessage(`Synced. ${data.created} added, ${data.updated} updated.`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-[var(--space-3)]">
      <Button variant="secondary" size="md" onClick={sync} disabled={busy} className="w-auto">
        {busy ? "Syncing…" : "Sync from registry"}
      </Button>
      {message && !error && (
        <span className="text-success-text text-[length:var(--text-sm)]">{message}</span>
      )}
      {error && <span className="text-danger-text text-[length:var(--text-sm)]">{error}</span>}
    </div>
  );
}
