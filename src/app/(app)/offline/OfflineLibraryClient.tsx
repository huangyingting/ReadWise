"use client";

/** Client-side IndexedDB implementation for the authenticated Offline Library. */

import { useEffect, useState } from "react";
import Link from "next/link";
import { WifiOff, Trash2, ExternalLink } from "lucide-react";
import {
  Button,
  EmptyState,
  PageHeader,
  PageShell,
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

      {articles === null && (
        <p className="text-text-muted" aria-live="polite">
          Loading…
        </p>
      )}

      {articles !== null && articles.length === 0 && (
        <EmptyState
          icon={WifiOff}
          title="No articles saved offline yet"
          description="Open any article and tap the Offline button to save it for later reading."
        />
      )}

      {articles !== null && articles.length > 0 && (
        <ul className="offline-library-list" aria-label="Offline articles">
          {articles.map((article) => (
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