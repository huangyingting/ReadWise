"use client";

/**
 * OfflineSyncIndicator (RW-042)
 *
 * Mounted once in the root layout. On mount it wires up connectivity-driven
 * syncing (`registerOfflineSync`) and subscribes to the offline mutation
 * queue's sync state. It renders a small fixed-position badge ONLY when there
 * is something to show — queued (pending) mutations or an in-progress sync —
 * so it's invisible in the common online case.
 */

import { useEffect, useState } from "react";
import { RefreshCw, CloudOff } from "lucide-react";
import { Button, Spinner } from "@/components/ui";
import {
  registerOfflineSync,
  subscribeSyncState,
  flushOfflineQueue,
  type SyncState,
} from "@/lib/offline/sync-runtime";

export default function OfflineSyncIndicator() {
  const [sync, setSync] = useState<SyncState>({
    pending: 0,
    syncing: false,
    lastResult: null,
  });

  useEffect(() => {
    registerOfflineSync();
    const unsubscribe = subscribeSyncState(setSync);
    return unsubscribe;
  }, []);

  // Nothing pending and not syncing → render nothing.
  if (sync.pending === 0 && !sync.syncing) return null;

  const label = sync.syncing
    ? "Syncing changes…"
    : sync.pending === 1
      ? "1 change waiting to sync"
      : `${sync.pending} changes waiting to sync`;

  return (
    <div
      role="status"
      aria-live="polite"
      className={[
        "fixed bottom-[var(--space-4)] left-1/2 -translate-x-1/2 z-[var(--z-overlay)]",
        "flex items-center gap-[var(--space-2)]",
        "rounded-[var(--radius-full,9999px)] border border-border",
        "bg-surface/95 px-[var(--space-3)] py-[var(--space-1-5,0.375rem)]",
        "text-[length:var(--text-xs)] text-text-muted shadow-md backdrop-blur",
      ].join(" ")}
    >
      {sync.syncing ? (
        <Spinner size={13} label="Syncing" />
      ) : (
        <CloudOff size={13} aria-hidden />
      )}
      <span>{label}</span>
      {!sync.syncing && sync.pending > 0 ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => void flushOfflineQueue()}
          className="h-auto px-0 py-0 font-semibold text-primary underline-offset-2 hover:underline"
        >
          Sync now
        </Button>
      ) : null}
    </div>
  );
}
