"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { patchJson } from "@/lib/client-fetch";
import { Switch } from "@/components/ui/Switch";
import { useMutation } from "@/hooks/useMutation";

interface AdminSourceActionsProps {
  providerKey: string;
  enabled: boolean;
}

function getStatusLabel(enabled: boolean) {
  return enabled ? "Enabled" : "Disabled";
}

/**
 * Per-row enable/disable toggle for a content source (RW-046). Disabling a
 * source stops the scraper from crawling that provider. The change is audited
 * server-side.
 */
export default function AdminSourceActions({
  providerKey,
  enabled,
}: AdminSourceActionsProps) {
  const router = useRouter();
  const [on, setOn] = useState(enabled);
  const { busy, error, run } = useMutation("Update failed");
  const statusLabel = getStatusLabel(on);

  async function toggle(next: boolean) {
    const prev = on;
    setOn(next);
    const updated = await run(async () => {
      await patchJson(`/api/admin/sources/${encodeURIComponent(providerKey)}`, {
        enabled: next,
      });
      return true;
    });
    if (updated) {
      router.refresh();
    } else {
      setOn(prev);
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
      <span className="text-[length:var(--text-sm)] muted">{statusLabel}</span>
      {error && (
        <span className="text-danger-text text-[length:var(--text-sm)]">{error}</span>
      )}
    </div>
  );
}
