"use client";

/**
 * OfflineDownloadButton (#117)
 *
 * Lets users save an article to IndexedDB for offline reading via the PWA.
 * Downloads the article content via GET /api/reader/[id]/offline and stores it
 * in IndexedDB via the offline-db helper.
 *
 * States: checking → idle → loading → saved (click to remove) → error
 *
 * Degrades gracefully when IndexedDB is unavailable (e.g. private browsing).
 */

import { useCallback, useEffect, useState } from "react";
import { Download, Check, Trash2, WifiOff } from "lucide-react";
import { Button, PanelError, Tooltip } from "@/components/ui";
import {
  saveOfflineArticle,
  removeOfflineArticle,
  isArticleOffline,
  getOfflineArticleVersion,
  MAX_OFFLINE_ARTICLES,
  getAllOfflineArticles,
} from "@/lib/offline/article-store";
import type { OfflineArticle } from "@/lib/offline/article-store";

type State = "checking" | "idle" | "loading" | "saved" | "error" | "unsupported";
type ErrorMode = "availability" | "download";

function offlineArticleUrl(articleId: string, meta = false): string {
  return `/api/reader/${articleId}/offline${meta ? "?meta=1" : ""}`;
}

async function readDownloadError(res: Response): Promise<string> {
  const data = (await res.json().catch(() => null)) as {
    error?: string;
  } | null;

  return data?.error ?? "Download failed";
}

export default function OfflineDownloadButton({
  articleId,
}: {
  articleId: string;
}) {
  const [state, setState] = useState<State>("checking");
  const [error, setError] = useState<string | null>(null);
  const [errorMode, setErrorMode] = useState<ErrorMode>("download");
  const [confirmRemove, setConfirmRemove] = useState(false);

  /**
   * Compare the stored version with the server's current one (cheap `?meta=1`
   * call). If the content changed, silently re-download; if the article was
   * deleted (404), drop the stale offline copy. Best-effort and offline-safe.
   */
  const revalidateCachedCopy = useCallback(async () => {
    try {
      const stored = await getOfflineArticleVersion(articleId);
      // binary/offline content: response may not be JSON; routed through raw fetch
      const res = await fetch(offlineArticleUrl(articleId, true));
      if (res.status === 404) {
        await removeOfflineArticle(articleId);
        setState("idle");
        return;
      }
      if (!res.ok) return; // transient — keep what we have
      const meta = (await res.json()) as { version?: string };
      if (meta.version && meta.version !== stored) {
        const full = await fetch(offlineArticleUrl(articleId));
        if (full.ok) {
          const data = (await full.json()) as Omit<OfflineArticle, "savedAt">;
          await saveOfflineArticle(data);
        }
      }
    } catch {
      // Offline or network error — keep the existing copy.
    }
  }, [articleId]);

  const checkOfflineAvailability = useCallback(async (isCancelled: () => boolean = () => false) => {
    if (typeof indexedDB === "undefined") {
      if (!isCancelled()) setState("unsupported");
      return;
    }
    setState("checking");
    setError(null);
    try {
      const saved = await isArticleOffline(articleId);
      if (isCancelled()) return;
      setState(saved ? "saved" : "idle");
      if (saved) void revalidateCachedCopy();
    } catch {
      if (isCancelled()) return;
      setError("Offline storage couldn’t be checked. Please retry.");
      setErrorMode("availability");
      setState("error");
    }
  }, [articleId, revalidateCachedCopy]);

  // Check initial state on mount; if already saved, revalidate the cached copy
  // against the server version and refresh (or drop) it as needed (RW-044).
  useEffect(() => {
    let cancelled = false;
    void checkOfflineAvailability(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [checkOfflineAvailability]);

  async function handleDownload() {
    setState("loading");
    setError(null);
    try {
      // Cap check — warn before the last download uses the cap.
      const all = await getAllOfflineArticles();
      if (all.length >= MAX_OFFLINE_ARTICLES) {
        setError(
          `Offline library is full (${MAX_OFFLINE_ARTICLES} articles). Remove some before downloading more.`,
        );
        setState("idle");
        return;
      }

      const res = await fetch(offlineArticleUrl(articleId));
      if (!res.ok) {
        throw new Error(await readDownloadError(res));
      }
      const data = (await res.json()) as Omit<OfflineArticle, "savedAt">;
      await saveOfflineArticle(data);
      setState("saved");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Download failed");
      setErrorMode("download");
      setState("error");
    }
  }

  async function handleRemove() {
    await removeOfflineArticle(articleId);
    setState("idle");
    setConfirmRemove(false);
  }

  function dismissError() {
    setState("idle");
    setError(null);
  }

  if (state === "unsupported") {
    return (
      <Tooltip content="Offline reading needs browser storage, which is unavailable in this browser or mode.">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="offline-btn"
          disabled
          aria-label="Offline reading unavailable: browser storage is unavailable"
          leadingIcon={<WifiOff size={13} aria-hidden />}
        >
          Offline unavailable
        </Button>
      </Tooltip>
    );
  }

  if (state === "saved") {
    if (confirmRemove) {
      return (
        <span className="offline-btn-group">
          <span className="offline-remove-prompt">Remove offline copy?</span>
          <Button
            type="button"
            variant="danger-ghost"
            size="sm"
            className="offline-btn offline-btn--danger"
            onClick={() => void handleRemove()}
            aria-label="Confirm remove offline article"
            leadingIcon={<Trash2 size={13} aria-hidden />}
          >
            Remove
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="offline-btn"
            onClick={() => setConfirmRemove(false)}
            aria-label="Cancel remove"
          >
            Cancel
          </Button>
        </span>
      );
    }
    return (
      <Tooltip content="Saved for offline reading — click to remove">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="offline-btn offline-btn--saved"
          onClick={() => setConfirmRemove(true)}
          aria-label="Article saved offline — click to remove"
          leadingIcon={<Check size={13} aria-hidden />}
        >
          Downloaded
        </Button>
      </Tooltip>
    );
  }

  if (state === "error") {
    return (
      <span className="offline-btn-group">
        {error && (
          <PanelError message={error} />
        )}
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="offline-btn"
          onClick={() => {
            if (errorMode === "availability") {
              void checkOfflineAvailability();
            } else {
              void handleDownload();
            }
          }}
        >
          Retry
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="offline-btn"
          onClick={dismissError}
          aria-label="Dismiss error"
        >
          Dismiss
        </Button>
      </span>
    );
  }

  return (
    <Tooltip content="Download for offline reading">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="offline-btn"
        onClick={() => void handleDownload()}
        disabled={state === "loading" || state === "checking"}
        aria-label={
          state === "checking"
            ? "Checking offline availability…"
            : state === "loading" ? "Downloading article…" : "Download for offline reading"
        }
        leadingIcon={
          state === "loading" || state === "checking"
            ? <WifiOff size={13} aria-hidden />
            : <Download size={13} aria-hidden />
        }
      >
        {state === "checking" ? "Checking…" : state === "loading" ? "Saving…" : "Offline"}
      </Button>
    </Tooltip>
  );
}
