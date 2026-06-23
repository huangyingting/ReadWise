"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Switch } from "@/components/ui/Switch";

/**
 * Per-row enable/disable toggle for a content source (RW-046). Disabling a
 * source stops the scraper from crawling that provider. The change is audited
 * server-side.
 */
export default function AdminSourceActions({
  providerKey,
  enabled,
}: {
  providerKey: string;
  enabled: boolean;
}) {
  const router = useRouter();
  const [on, setOn] = useState(enabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle(next: boolean) {
    setBusy(true);
    setError(null);
    const prev = on;
    setOn(next);
    try {
      const res = await fetch(`/api/admin/sources/${encodeURIComponent(providerKey)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? `Update failed (${res.status})`);
      }
      router.refresh();
    } catch (err) {
      setOn(prev);
      setError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-[var(--space-2)]">
      <Switch
        checked={on}
        onCheckedChange={toggle}
        disabled={busy}
        aria-label={`${on ? "Disable" : "Enable"} ${providerKey}`}
      />
      <span className="text-[length:var(--text-sm)] muted">{on ? "Enabled" : "Disabled"}</span>
      {error && (
        <span className="text-danger-text text-[length:var(--text-sm)]">{error}</span>
      )}
    </div>
  );
}
