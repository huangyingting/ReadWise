"use client";

import { useState, useCallback, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";

export type WordEntry = {
  id: string;
  word: string;
  explanation: string | null;
  example: string | null;
  contextSentence: string | null;
  articleId: string | null;
  createdAt: string;
  dueAt: string | null;
};

export type JournalData = {
  words: WordEntry[];
  articles: Record<string, string>;
  total: number;
  page: number;
  totalPages: number;
  pageSize: number;
};

interface Props {
  initial: JournalData;
  initialQuery: string;
  initialArticleId: string;
  initialFilter: "all" | "due" | "new";
}

export default function VocabularyJournal({
  initial,
  initialQuery,
  initialArticleId,
  initialFilter,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const [data, setData] = useState<JournalData>(initial);
  const [query, setQuery] = useState(initialQuery);
  const [articleId, setArticleId] = useState(initialArticleId);
  const [filter, setFilter] = useState<"all" | "due" | "new">(initialFilter);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkPending, setBulkPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchWords = useCallback(
    async (opts: {
      q?: string;
      articleId?: string;
      filter?: "all" | "due" | "new";
      page?: number;
    }) => {
      const params = new URLSearchParams(searchParams.toString());
      if (opts.q !== undefined) { params.set("q", opts.q); params.delete("page"); }
      if (opts.articleId !== undefined) { opts.articleId ? params.set("articleId", opts.articleId) : params.delete("articleId"); params.delete("page"); }
      if (opts.filter !== undefined) { params.set("filter", opts.filter); params.delete("page"); }
      if (opts.page !== undefined) { params.set("page", String(opts.page)); }

      startTransition(() => {
        router.replace(`/study/words?${params.toString()}`, { scroll: false });
      });

      const res = await fetch(`/api/study/words?${params.toString()}`);
      if (!res.ok) return;
      const json = (await res.json()) as JournalData;
      setData(json);
      setSelected(new Set());
    },
    [router, searchParams],
  );

  const handleSearch = useCallback(
    (value: string) => {
      setQuery(value);
      void fetchWords({ q: value });
    },
    [fetchWords],
  );

  const handleFilterChange = useCallback(
    (value: "all" | "due" | "new") => {
      setFilter(value);
      void fetchWords({ filter: value });
    },
    [fetchWords],
  );

  const handleArticleFilter = useCallback(
    (value: string) => {
      setArticleId(value);
      void fetchWords({ articleId: value });
    },
    [fetchWords],
  );

  const handlePageChange = useCallback(
    (page: number) => {
      void fetchWords({ page });
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    [fetchWords],
  );

  const toggleSelect = (word: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(word)) next.delete(word);
      else next.add(word);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selected.size === data.words.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(data.words.map((w) => w.word)));
    }
  };

  const handleBulkRemove = async () => {
    if (selected.size === 0) return;
    setBulkPending(true);
    setError(null);
    try {
      const res = await fetch("/api/vocabulary/unsave-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ words: Array.from(selected) }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(d?.error ?? "Could not remove words");
      }
      // Re-fetch current page (may shrink)
      await fetchWords({});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove words");
    } finally {
      setBulkPending(false);
    }
  };

  // Build list of articles that have saved words (for filter dropdown)
  const articleOptions = Object.entries(data.articles);

  const filterLabels: Record<"all" | "due" | "new", string> = {
    all: "All",
    due: "Due for review",
    new: "Never reviewed",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-5)" }}>
      {/* Search + filters */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-3)", alignItems: "flex-end" }}>
        <div style={{ flex: "1 1 240px", minWidth: 200 }}>
          <label className="text-[length:var(--text-sm)] text-text-muted mb-[var(--space-1)] block" htmlFor="word-search">
            Search
          </label>
          <Input
            id="word-search"
            type="search"
            placeholder="Search by word or definition…"
            value={query}
            onChange={(e) => handleSearch(e.target.value)}
            aria-label="Search saved words"
          />
        </div>

        <div style={{ flex: "0 1 200px", minWidth: 150 }}>
          <label className="text-[length:var(--text-sm)] text-text-muted mb-[var(--space-1)] block" htmlFor="srs-filter">
            SRS filter
          </label>
          <select
            id="srs-filter"
            value={filter}
            onChange={(e) => handleFilterChange(e.target.value as "all" | "due" | "new")}
            className="w-full rounded-[var(--radius-md)] border border-border bg-bg text-text px-[var(--space-3)] py-[var(--space-2)] text-[length:var(--text-sm)]"
            aria-label="Filter by SRS status"
          >
            {(["all", "due", "new"] as const).map((f) => (
              <option key={f} value={f}>{filterLabels[f]}</option>
            ))}
          </select>
        </div>

        {articleOptions.length > 0 && (
          <div style={{ flex: "0 1 220px", minWidth: 160 }}>
            <label className="text-[length:var(--text-sm)] text-text-muted mb-[var(--space-1)] block" htmlFor="article-filter">
              Article source
            </label>
            <select
              id="article-filter"
              value={articleId}
              onChange={(e) => handleArticleFilter(e.target.value)}
              className="w-full rounded-[var(--radius-md)] border border-border bg-bg text-text px-[var(--space-3)] py-[var(--space-2)] text-[length:var(--text-sm)]"
              aria-label="Filter by article source"
            >
              <option value="">All articles</option>
              {articleOptions.map(([id, title]) => (
                <option key={id} value={id}>{title}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Toolbar */}
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", flexWrap: "wrap" }}>
        <p className="text-[length:var(--text-sm)] text-text-muted m-0" aria-live="polite">
          {isPending ? "Loading…" : `${data.total} ${data.total === 1 ? "word" : "words"}`}
        </p>

        {data.words.length > 0 && (
          <>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={toggleSelectAll}
              aria-pressed={selected.size === data.words.length && data.words.length > 0}
            >
              {selected.size === data.words.length && data.words.length > 0
                ? "Deselect all"
                : `Select all (${data.words.length})`}
            </Button>

            {selected.size > 0 && (
              <Button
                type="button"
                variant="danger"
                size="sm"
                onClick={() => void handleBulkRemove()}
                disabled={bulkPending}
              >
                {bulkPending ? "Removing…" : `Remove selected (${selected.size})`}
              </Button>
            )}
          </>
        )}
      </div>

      {error ? (
        <p className="vocabulary-error" role="alert">{error}</p>
      ) : null}

      {/* Words table */}
      {data.words.length === 0 ? (
        <div className="text-center py-[var(--space-10)]">
          <p className="text-text-muted text-[length:var(--text-base)] m-0">
            {data.total === 0 && !query && !articleId
              ? "No saved words yet. Start reading and save vocabulary to build your list."
              : "No words match your search."}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="admin-table w-full" style={{ tableLayout: "auto" }}>
            <thead>
              <tr>
                <th style={{ width: 40 }}>
                  <span className="sr-only">Select</span>
                </th>
                <th>Word</th>
                <th>Definition</th>
                <th>Article</th>
                <th>Saved</th>
                <th>SRS</th>
              </tr>
            </thead>
            <tbody>
              {data.words.map((word) => (
                <tr key={word.id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selected.has(word.word)}
                      onChange={() => toggleSelect(word.word)}
                      aria-label={`Select ${word.word}`}
                      className="h-4 w-4 rounded border-border"
                    />
                  </td>
                  <td>
                    <strong className="vocabulary-word text-[length:var(--text-sm)]">{word.word}</strong>
                    {word.contextSentence || word.example ? (
                      <p className="text-[length:var(--text-xs)] text-text-muted m-0 mt-[var(--space-1)] italic" style={{ maxWidth: "28ch" }}>
                        &ldquo;{word.contextSentence ?? word.example}&rdquo;
                      </p>
                    ) : null}
                  </td>
                  <td>
                    <p className="text-[length:var(--text-sm)] text-text m-0" style={{ maxWidth: "30ch" }}>
                      {word.explanation ?? <span className="text-text-muted">—</span>}
                    </p>
                  </td>
                  <td>
                    {word.articleId && data.articles[word.articleId] ? (
                      <Link
                        href={`/reader/${word.articleId}`}
                        className="text-[length:var(--text-xs)] text-primary hover:underline"
                        title={data.articles[word.articleId]}
                      >
                        {data.articles[word.articleId].length > 35
                          ? data.articles[word.articleId].slice(0, 32) + "…"
                          : data.articles[word.articleId]}
                      </Link>
                    ) : (
                      <span className="text-text-muted text-[length:var(--text-xs)]">—</span>
                    )}
                  </td>
                  <td>
                    <time
                      dateTime={word.createdAt}
                      className="text-[length:var(--text-xs)] text-text-muted whitespace-nowrap"
                    >
                      {new Date(word.createdAt).toLocaleDateString()}
                    </time>
                  </td>
                  <td>
                    {word.dueAt == null ? (
                      <Badge variant="primary" className="text-[length:var(--text-xs)]">New</Badge>
                    ) : new Date(word.dueAt) <= new Date() ? (
                      <Badge variant="warning" className="text-[length:var(--text-xs)]">Due</Badge>
                    ) : (
                      <Badge variant="neutral" className="text-[length:var(--text-xs)] whitespace-nowrap">
                        {new Date(word.dueAt).toLocaleDateString()}
                      </Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {data.totalPages > 1 && (
        <nav aria-label="Vocabulary journal pages" className="admin-pagination">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={data.page <= 1 || isPending}
            onClick={() => handlePageChange(data.page - 1)}
          >
            ← Previous
          </Button>
          <span className="text-[length:var(--text-sm)] text-text-muted">
            Page {data.page} of {data.totalPages}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={data.page >= data.totalPages || isPending}
            onClick={() => handlePageChange(data.page + 1)}
          >
            Next →
          </Button>
        </nav>
      )}
    </div>
  );
}
