"use client";

/**
 * Offline Library page (#117)
 *
 * Lists articles saved for offline reading. Reads entirely from IndexedDB —
 * no server requests — so this page works when the user is offline (JS bundles
 * are cached by the service worker).
 *
 * This is a "use client" page because it needs IndexedDB access and renders
 * client-side only. It is gated by a session check via middleware, but does NOT
 * call requireSession (no server component needed — the middleware redirect is
 * sufficient here since content comes from IndexedDB, not the server).
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { WifiOff, Trash2, ExternalLink } from "lucide-react";
import {
  getAllOfflineArticles,
  removeOfflineArticle,
  type OfflineArticle,
} from "@/lib/offline/article-store";

export default function OfflineLibraryPage() {
  const [articles, setArticles] = useState<OfflineArticle[] | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [supported, setSupported] = useState(true);

  useEffect(() => {
    if (typeof indexedDB === "undefined") {
      setSupported(false);
      setArticles([]);
      return;
    }
    getAllOfflineArticles()
      .then(setArticles)
      .catch(() => setArticles([]));
  }, []);

  async function handleRemove(id: string) {
    setRemoving(id);
    try {
      await removeOfflineArticle(id);
      setArticles((prev) => prev?.filter((a) => a.id !== id) ?? []);
    } finally {
      setRemoving(null);
    }
  }

  return (
    <main className="container">
      <div className="offline-library-header">
        <h1 className="offline-library-title">
          <WifiOff size={22} aria-hidden />
          Offline Library
        </h1>
        <p className="muted">
          Articles saved here are available when you&apos;re offline.
          They expire after 30 days.
        </p>
      </div>

      {!supported && (
        <p className="muted" role="status">
          Offline storage is not available in this browser (may be a private
          browsing restriction).
        </p>
      )}

      {articles === null && (
        <p className="muted" aria-live="polite">
          Loading…
        </p>
      )}

      {articles !== null && articles.length === 0 && (
        <div className="offline-library-empty">
          <p>No articles saved offline yet.</p>
          <p className="muted">
            Open any article and tap the{" "}
            <strong>Offline</strong> button to save it for later reading.
          </p>
        </div>
      )}

      {articles !== null && articles.length > 0 && (
        <ul className="offline-library-list" aria-label="Offline articles">
          {articles.map((article) => {
            const savedDate = new Date(article.savedAt);
            const expiryDate = new Date(
              savedDate.getTime() + 30 * 24 * 60 * 60 * 1000,
            );
            const daysLeft = Math.max(
              0,
              Math.ceil(
                (expiryDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000),
              ),
            );

            return (
              <li key={article.id} className="offline-library-item">
                <div className="offline-library-item-content">
                  <Link
                    href={`/reader/${article.id}`}
                    className="offline-library-item-title"
                  >
                    {article.title}
                  </Link>
                  <div className="offline-library-item-meta">
                    {article.author && (
                      <span>{article.author}</span>
                    )}
                    {article.readingMinutes != null && (
                      <span>⏱ {article.readingMinutes} min</span>
                    )}
                    {article.difficulty && (
                      <span>{article.difficulty}</span>
                    )}
                    <span className="muted">Expires in {daysLeft}d</span>
                  </div>
                </div>
                <div className="offline-library-item-actions">
                  <Link
                    href={`/reader/${article.id}`}
                    className="offline-btn offline-btn--sm"
                    aria-label={`Read ${article.title}`}
                  >
                    <ExternalLink size={12} aria-hidden />
                    Read
                  </Link>
                  <button
                    type="button"
                    className="offline-btn offline-btn--danger offline-btn--sm"
                    onClick={() => void handleRemove(article.id)}
                    disabled={removing === article.id}
                    aria-label={`Remove ${article.title} from offline library`}
                  >
                    <Trash2 size={12} aria-hidden />
                    {removing === article.id ? "…" : "Remove"}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
