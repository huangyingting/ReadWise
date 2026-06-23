"use client";

/**
 * OfflineDownloadButton (#117)
 *
 * Lets users save an article to IndexedDB for offline reading via the PWA.
 * Downloads the article content via GET /api/reader/[id]/offline and stores it
 * in IndexedDB via the offline-db helper.
 *
 * States: idle → loading → saved (click to remove) → error
 *
 * Degrades gracefully when IndexedDB is unavailable (e.g. private browsing).
 */

import { useEffect, useState } from "react";
import { Download, Check, Trash2, WifiOff } from "lucide-react";
import {
  saveOfflineArticle,
  removeOfflineArticle,
  isArticleOffline,
  getOfflineArticleVersion,
  MAX_OFFLINE_ARTICLES,
  getAllOfflineArticles,
} from "@/lib/offline-db";
import type { OfflineArticle } from "@/lib/offline-db";

type State = "idle" | "loading" | "saved" | "error" | "unsupported";

export default function OfflineDownloadButton({
  articleId,
}: {
  articleId: string;
}) {
  const [state, setState] = useState<State>("idle");
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  // Check initial state on mount; if already saved, revalidate the cached copy
  // against the server version and refresh (or drop) it as needed (RW-044).
  useEffect(() => {
    if (typeof indexedDB === "undefined") {
      setState("unsupported");
      return;
    }
    let cancelled = false;
    isArticleOffline(articleId)
      .then((saved) => {
        if (cancelled) return;
        setState(saved ? "saved" : "idle");
        if (saved) void revalidateCachedCopy();
      })
      .catch(() => setState("idle"));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [articleId]);

  /**
   * Compare the stored version with the server's current one (cheap `?meta=1`
   * call). If the content changed, silently re-download; if the article was
   * deleted (404), drop the stale offline copy. Best-effort and offline-safe.
   */
  async function revalidateCachedCopy() {
    try {
      const stored = await getOfflineArticleVersion(articleId);
      const res = await fetch(`/api/reader/${articleId}/offline?meta=1`);
      if (res.status === 404) {
        await removeOfflineArticle(articleId);
        setState("idle");
        return;
      }
      if (!res.ok) return; // transient — keep what we have
      const meta = (await res.json()) as { version?: string };
      if (meta.version && meta.version !== stored) {
        const full = await fetch(`/api/reader/${articleId}/offline`);
        if (full.ok) {
          const data = (await full.json()) as Omit<OfflineArticle, "savedAt">;
          await saveOfflineArticle(data);
        }
      }
    } catch {
      // Offline or network error — keep the existing copy.
    }
  }

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

      const res = await fetch(`/api/reader/${articleId}/offline`);
      if (!res.ok) {
        const d = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(d?.error ?? "Download failed");
      }
      const data = (await res.json()) as Omit<OfflineArticle, "savedAt">;
      await saveOfflineArticle(data);
      setState("saved");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Download failed");
      setState("error");
    }
  }

  async function handleRemove() {
    await removeOfflineArticle(articleId);
    setState("idle");
    setConfirmRemove(false);
  }

  if (state === "unsupported") return null;

  if (state === "saved") {
    if (confirmRemove) {
      return (
        <span className="offline-btn-group">
          <span className="offline-remove-prompt">Remove offline copy?</span>
          <button
            type="button"
            className="offline-btn offline-btn--danger"
            onClick={() => void handleRemove()}
            aria-label="Confirm remove offline article"
          >
            <Trash2 size={13} aria-hidden />
            Remove
          </button>
          <button
            type="button"
            className="offline-btn"
            onClick={() => setConfirmRemove(false)}
            aria-label="Cancel remove"
          >
            Cancel
          </button>
        </span>
      );
    }
    return (
      <button
        type="button"
        className="offline-btn offline-btn--saved"
        onClick={() => setConfirmRemove(true)}
        aria-label="Article saved offline — click to remove"
        title="Saved for offline reading — click to remove"
      >
        <Check size={13} aria-hidden />
        Downloaded
      </button>
    );
  }

  if (state === "error") {
    return (
      <span className="offline-btn-group">
        {error && (
          <span className="offline-error" role="alert">
            {error}
          </span>
        )}
        <button
          type="button"
          className="offline-btn"
          onClick={() => { setState("idle"); setError(null); }}
          aria-label="Dismiss error"
        >
          Dismiss
        </button>
      </span>
    );
  }

  return (
    <button
      type="button"
      className="offline-btn"
      onClick={() => void handleDownload()}
      disabled={state === "loading"}
      aria-label={
        state === "loading" ? "Downloading article…" : "Download for offline reading"
      }
      title="Download for offline reading"
    >
      {state === "loading" ? (
        <>
          <WifiOff size={13} aria-hidden />
          Saving…
        </>
      ) : (
        <>
          <Download size={13} aria-hidden />
          Offline
        </>
      )}
    </button>
  );
}
