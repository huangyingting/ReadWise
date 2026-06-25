"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@/hooks/useMutation";
import { postJson } from "@/lib/client-fetch";
import { Button } from "@/components/ui/Button";

/**
 * Syncs `ContentSource` rows from the code provider registry (RW-046). Inserts
 * any providers missing a row and refreshes display metadata. Audited.
 */
export default function AdminSourceSync() {
  const router = useRouter();
  const { busy, error, run } = useMutation("Sync failed");
  const [message, setMessage] = useState<string | null>(null);

  async function sync() {
    setMessage(null);
    await run(async () => {
      const data = await postJson<{ created: number; updated: number }>(
        "/api/admin/sources/sync",
      );
      setMessage(`Synced. ${data.created} added, ${data.updated} updated.`);
      router.refresh();
    });
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
