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

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useSession } from "next-auth/react";
import { CloudOff, ShieldAlert } from "lucide-react";
import { Button, EmptyState, Spinner } from "@/components/ui";
import {
  registerOfflineSync,
  setOfflineSyncActor,
  subscribeSyncState,
  flushOfflineQueue,
  type SyncState,
} from "@/lib/offline/sync-runtime";
import { STORAGE_KEYS, lsGet } from "@/lib/storage-keys";
import { shouldBlockOfflineView } from "@/lib/offline/ownership-visibility";

const INITIAL_SYNC_STATE: SyncState = {
  pending: 0,
  syncing: false,
  lastResult: null,
};

function shouldShowSyncIndicator(sync: SyncState): boolean {
  return sync.pending > 0 || sync.syncing;
}

function getSyncLabel(sync: SyncState): string {
  if (sync.syncing) return "Syncing changes…";
  if (sync.pending === 1) return "1 change waiting to sync";
  return `${sync.pending} changes waiting to sync`;
}

type OwnershipState = "checking" | "ready" | "blocked" | "error";

export default function OfflineSyncIndicator({
  children,
}: {
  children: ReactNode;
}) {
  const { data: session, status: sessionStatus } = useSession();
  const [sync, setSync] = useState<SyncState>(INITIAL_SYNC_STATE);
  const [ownershipState, setOwnershipState] =
    useState<OwnershipState>("ready");
  const renderedActorRef = useRef(session?.user?.id ?? null);

  useEffect(() => {
    const unsubscribe = subscribeSyncState(setSync);
    return unsubscribe;
  }, []);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (
        event.key !== STORAGE_KEYS.OFFLINE_ACTOR_ID &&
        event.key !== STORAGE_KEYS.OFFLINE_ACCESS_BLOCKED
      ) {
        return;
      }
      const actorId = session?.user?.id ?? null;
      const durableActorId = lsGet(STORAGE_KEYS.OFFLINE_ACTOR_ID);
      if (shouldBlockOfflineView(
        actorId,
        durableActorId,
        lsGet(STORAGE_KEYS.OFFLINE_ACCESS_BLOCKED) === "1",
      )) {
        setOwnershipState("blocked");
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [session?.user?.id]);

  useLayoutEffect(() => {
    if (sessionStatus === "loading") return;
    let cancelled = false;
    setOwnershipState("checking");
    const actorId =
      sessionStatus === "authenticated" ? session?.user?.id ?? null : null;
    void setOfflineSyncActor(actorId).then(() => {
      if (cancelled) return;
      if (shouldBlockOfflineView(
        actorId,
        lsGet(STORAGE_KEYS.OFFLINE_ACTOR_ID),
        lsGet(STORAGE_KEYS.OFFLINE_ACCESS_BLOCKED) === "1",
      )) {
        setOwnershipState("blocked");
        return;
      }
      const renderedActor = renderedActorRef.current;
      if (
        renderedActor !== null &&
        renderedActor !== actorId
      ) {
        window.location.reload();
        return;
      }
      if (actorId !== null) renderedActorRef.current = actorId;
      setOwnershipState("ready");
      if (actorId) registerOfflineSync();
    }).catch(() => {
      if (!cancelled) setOwnershipState("error");
    });
    return () => {
      cancelled = true;
    };
  }, [session?.user?.id, sessionStatus]);

  if (ownershipState === "checking") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-bg px-[var(--space-6)]">
        <Spinner label="Preparing private offline data" />
      </main>
    );
  }

  if (ownershipState === "error") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-bg px-[var(--space-6)]">
        <EmptyState
          icon={ShieldAlert}
          title="Offline data could not be secured"
          description="Reload this page after closing other ReadWise tabs. Your account data has not been opened."
          action={
            <Button type="button" onClick={() => window.location.reload()}>
              Reload
            </Button>
          }
          titleAs="h1"
          role="alert"
        />
      </main>
    );
  }

  if (ownershipState === "blocked") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-bg px-[var(--space-6)]">
        <EmptyState
          icon={ShieldAlert}
          title="This session changed in another tab"
          description="Reload to continue with the current account. Private offline data remains hidden."
          action={
            <Button type="button" onClick={() => window.location.reload()}>
              Reload
            </Button>
          }
          titleAs="h1"
          role="alert"
        />
      </main>
    );
  }

  const indicator = shouldShowSyncIndicator(sync) ? (
    <SyncIndicatorBadge sync={sync} />
  ) : null;

  return (
    <>
      {children}
      {indicator}
    </>
  );
}

function SyncIndicatorBadge({ sync }: { sync: SyncState }) {
  // Nothing pending and not syncing → render nothing.
  const label = getSyncLabel(sync);

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
      {!sync.syncing && sync.pending > 0 ? <SyncNowButton /> : null}
    </div>
  );
}

function SyncNowButton() {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={() => void flushOfflineQueue()}
      className="h-auto px-0 py-0 font-semibold text-primary underline-offset-2 hover:underline"
    >
      Sync now
    </Button>
  );
}
