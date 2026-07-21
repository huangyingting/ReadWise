"use client";

/** Client-side IndexedDB implementation for the authenticated Offline Library. */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { WifiOff, Trash2, ExternalLink } from "lucide-react";
import {
  Button,
  EmptyState,
  PageHeader,
  PageShell,
  SkeletonText,
  Stack,
  buttonVariants,
} from "@/components/ui";
import {
  getAllOfflineArticles,
  removeOfflineArticle,
  type OfflineArticle,
} from "@/lib/offline/article-store";

const OFFLINE_RETENTION_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

type OfflineLibraryState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; articles: OfflineArticle[] };

function daysUntilExpiry(savedAt: string): number {
  const savedDate = new Date(savedAt);
  const expiryDate = new Date(savedDate.getTime() + OFFLINE_RETENTION_DAYS * MS_PER_DAY);
  return Math.max(0, Math.ceil((expiryDate.getTime() - Date.now()) / MS_PER_DAY));
}

function OfflineArticleItem({
  article,
  removing,
  onRemove,
}: {
  article: OfflineArticle;
  removing: string | null;
  onRemove: (id: string) => void;
}) {
  const isRemoving = removing === article.id;

  return (
    <li className="offline-library-item">
      <div className="offline-library-item-content">
        <Link href={`/reader/${article.id}`} className="offline-library-item-title">
          {article.title}
        </Link>
        <div className="offline-library-item-meta">
          {article.author && <span>{article.author}</span>}
          {article.readingMinutes != null && (
            <span>⏱ {article.readingMinutes} min</span>
          )}
          {article.difficulty && <span>{article.difficulty}</span>}
          <span className="muted">Expires in {daysUntilExpiry(article.savedAt)}d</span>
        </div>
      </div>
      <Stack gap="2" align="start" className="offline-library-item-actions">
        <Link
          href={`/reader/${article.id}`}
          className={buttonVariants({ variant: "outline", size: "sm" })}
          aria-label={`Read ${article.title}`}
        >
          <ExternalLink size={12} aria-hidden />
          Read
        </Link>
        <Button
          variant="danger-ghost"
          size="sm"
          leadingIcon={<Trash2 size={12} aria-hidden />}
          onClick={() => onRemove(article.id)}
          disabled={isRemoving}
          aria-label={`Remove ${article.title} from offline library`}
        >
          {isRemoving ? "…" : "Remove"}
        </Button>
      </Stack>
    </li>
  );
}

export default function OfflineLibraryClient() {
  const [libraryState, setLibraryState] = useState<OfflineLibraryState>({
    status: "loading",
  });
  const [removing, setRemoving] = useState<string | null>(null);
  const [supported, setSupported] = useState(true);

  const loadOfflineArticles = useCallback(async (isCancelled: () => boolean) => {
    if (typeof indexedDB === "undefined") {
      setSupported(false);
      setLibraryState({ status: "ready", articles: [] });
      return;
    }
    setSupported(true);
    setLibraryState({ status: "loading" });
    try {
      const nextArticles = await getAllOfflineArticles();
      if (!isCancelled()) {
        setLibraryState({ status: "ready", articles: nextArticles });
      }
    } catch {
      if (!isCancelled()) {
        setLibraryState({
          status: "error",
          message: "Couldn't load your offline library.",
        });
      }
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadOfflineArticles(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [loadOfflineArticles]);

  async function handleRemove(id: string) {
    setRemoving(id);
    try {
      await removeOfflineArticle(id);
      setLibraryState((prev) =>
        prev.status === "ready"
          ? {
              status: "ready",
              articles: prev.articles.filter((article) => article.id !== id),
            }
          : prev,
      );
    } finally {
      setRemoving(null);
    }
  }

  function retryLoad() {
    void loadOfflineArticles(() => false);
  }

  return (
    <PageShell variant="listing">
      <PageHeader
        title="Offline Library"
        description="Articles saved here are available when you're offline. They expire after 30 days."
        eyebrow={
          <span className="inline-flex items-center gap-[var(--space-2)]">
            <WifiOff size={16} aria-hidden />
            Offline
          </span>
        }
      />

      {!supported && (
        <p className="text-text-muted" role="status">
          Offline storage is not available in this browser (may be a private
          browsing restriction).
        </p>
      )}

      {libraryState.status === "loading" && (
        <div aria-busy="true">
          <span className="sr-only" role="status">
            Loading offline library
          </span>
          <SkeletonText lines={3} className="w-full" />
        </div>
      )}

      {libraryState.status === "error" && (
        <EmptyState
          icon={WifiOff}
          title="Offline library couldn't load"
          description={libraryState.message}
          role="alert"
          action={
            <Button type="button" variant="outline" size="sm" onClick={retryLoad}>
              Retry
            </Button>
          }
        />
      )}

      {libraryState.status === "ready" && supported && libraryState.articles.length === 0 && (
        <EmptyState
          icon={WifiOff}
          title="No articles saved offline yet"
          description="Open any article and tap the Offline button to save it for later reading."
        />
      )}

      {libraryState.status === "ready" && libraryState.articles.length > 0 && (
        <ul className="offline-library-list" aria-label="Offline articles">
          {libraryState.articles.map((article) => (
            <OfflineArticleItem
              key={article.id}
              article={article}
              removing={removing}
              onRemove={(id) => void handleRemove(id)}
            />
          ))}
        </ul>
      )}
    </PageShell>
  );
}