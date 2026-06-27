"use client";

import { useState, useCallback, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { BookOpen } from "lucide-react";
import {
  Button,
  Field,
  Input,
  PanelError,
  Select,
  EmptyState,
  TableSurface,
  Toolbar,
} from "@/components/ui";
import { WordTableRow } from "@/components/vocabulary/WordTableRow";
import { JournalPagination } from "@/components/vocabulary/JournalPagination";
import { getJson, postJson } from "@/lib/client-fetch";
import { useFilteredFetch } from "@/hooks/useFilteredFetch";

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

  // Debounce + abort + stale-response guarding is delegated to useFilteredFetch.
  const { run } = useFilteredFetch<JournalData>(300);

  const fetchWords = useCallback(
    (
      opts: {
        q?: string;
        articleId?: string;
        filter?: "all" | "due" | "new";
        page?: number;
      },
      debounce = false,
    ) => {
      const params = new URLSearchParams(searchParams.toString());
      if (opts.q !== undefined) { params.set("q", opts.q); params.delete("page"); }
      if (opts.articleId !== undefined) { opts.articleId ? params.set("articleId", opts.articleId) : params.delete("articleId"); params.delete("page"); }
      if (opts.filter !== undefined) { params.set("filter", opts.filter); params.delete("page"); }
      if (opts.page !== undefined) { params.set("page", String(opts.page)); }

      const queryString = params.toString();

      run({
        immediate: !debounce,
        fetcher: async (signal) => {
          startTransition(() => {
            router.replace(`/study/words?${queryString}`, { scroll: false });
          });
          return getJson<JournalData>(`/api/study/words?${queryString}`, { signal });
        },
        // Swallow failures (incl. aborts) — keep current data rather than blanking
        // the table; only commit on a fresh, non-superseded success.
        onResult: (json) => {
          setData(json);
          setSelected(new Set());
        },
      });
    },
    [router, searchParams, run],
  );

  const handleSearch = useCallback(
    (value: string) => {
      setQuery(value);
      void fetchWords({ q: value }, true);
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
      await postJson("/api/vocabulary/unsave-batch", { words: Array.from(selected) });
      // Re-fetch current page (may shrink)
      fetchWords({});
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
    <div className="flex flex-col gap-[var(--space-5)]">
      {/* Search + filters */}
      <div className="flex flex-wrap gap-[var(--space-3)] items-end">
        <div className="flex-[1_1_240px] min-w-[200px]">
          <Field label="Search">
            <Input
              id="word-search"
              type="search"
              placeholder="Search by word or definition…"
              value={query}
              onChange={(e) => handleSearch(e.target.value)}
              aria-label="Search saved words"
            />
          </Field>
        </div>

        <div className="flex-[0_1_200px] min-w-[150px]">
          <Field label="Review filter">
            <Select
              id="srs-filter"
              value={filter}
              onChange={(e) => handleFilterChange(e.target.value as "all" | "due" | "new")}
              aria-label="Filter by review status"
            >
              {(["all", "due", "new"] as const).map((f) => (
                <option key={f} value={f}>{filterLabels[f]}</option>
              ))}
            </Select>
          </Field>
        </div>

        {articleOptions.length > 0 && (
          <div className="flex-[0_1_220px] min-w-[160px]">
            <Field label="Article source">
              <Select
                id="article-filter"
                value={articleId}
                onChange={(e) => handleArticleFilter(e.target.value)}
                aria-label="Filter by article source"
              >
                <option value="">All articles</option>
                {articleOptions.map(([id, title]) => (
                  <option key={id} value={id}>{title}</option>
                ))}
              </Select>
            </Field>
          </div>
        )}
      </div>

      {/* Toolbar */}
      <Toolbar justify="start">
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
      </Toolbar>

      {error ? <PanelError message={error} /> : null}

      {/* Words table */}
      {data.words.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title={
            data.total === 0 && !query && !articleId
              ? "No saved words yet"
              : "No words match your search"
          }
          description={
            data.total === 0 && !query && !articleId
              ? "Start reading and save vocabulary to build your list."
              : "Try a different word or definition — or clear your filters."
          }
        />
      ) : (
        <TableSurface>
          <table className="admin-table w-full table-auto">
            <thead>
              <tr>
                <th className="w-[var(--space-10)]">
                  <span className="sr-only">Select</span>
                </th>
                <th>Word</th>
                <th>Definition</th>
                <th>Article</th>
                <th>Saved</th>
                <th>
                  <span title="Review due date based on spaced repetition — words you review just before you forget them stick best.">
                    Review due
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.words.map((word) => (
                <WordTableRow
                  key={word.id}
                  word={word}
                  articles={data.articles}
                  selected={selected.has(word.word)}
                  onToggle={() => toggleSelect(word.word)}
                />
              ))}
            </tbody>
          </table>
        </TableSurface>
      )}

      <JournalPagination
        page={data.page}
        totalPages={data.totalPages}
        isPending={isPending}
        onPageChange={handlePageChange}
      />
    </div>
  );
}
