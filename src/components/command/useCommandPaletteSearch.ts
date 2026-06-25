"use client";

import { useMemo } from "react";
import {
  getPageItems,
  ACTION_ITEMS,
  fuzzyFilter,
  type PageSelectable,
  type ActionSelectable,
  type ArticleSelectable,
  type MoreSelectable,
  type SelectableItem,
} from "./command-items";
import { useArticleSearch, type SearchStatus } from "./useArticleSearch";
import type { ShellUser } from "@/components/shell/types";
import type { ListingArticle } from "@/lib/article-library";

export interface UseCommandPaletteSearchOptions {
  user: ShellUser | null;
  query: string;
}

export interface UseCommandPaletteSearchResult {
  // Grouped selectable items
  filteredPages: PageSelectable[];
  filteredActions: ActionSelectable[];
  articleSelectables: ArticleSelectable[];
  moreSelectable: MoreSelectable | null;
  /** Flat ordered list of all selectable items (for keyboard-nav indexing). */
  selectableItems: SelectableItem[];
  /** ariaId → position index map for hover activation. */
  ariaIdToIndex: Map<string, number>;
  // Article search state
  status: SearchStatus;
  articles: ListingArticle[];
  error: string | null;
  search: (query: string) => void;
  loadMore: (query: string, offset: number) => void;
  // Derived display flags
  isLoading: boolean;
  /** True on the very first load (query ≥ 2, no articles yet). Show skeletons. */
  isFirstLoad: boolean;
  showArticleGroup: boolean;
  hasNoResults: boolean;
  trimmedQuery: string;
}

/**
 * Combines page/action item derivation and filtering with the article search
 * hook into a single search state for the command palette.
 *
 * Separation:
 *   - Page/action filtering is synchronous and purely client-side.
 *   - Article search is async (debounced fetch via useArticleSearch).
 *   - This hook owns the assembly of the final `selectableItems` array.
 */
export function useCommandPaletteSearch({
  user,
  query,
}: UseCommandPaletteSearchOptions): UseCommandPaletteSearchResult {
  const { status, articles, hasMore, nextOffset, error, search, loadMore } =
    useArticleSearch();

  const trimmedQuery = query.trim();

  const pageItems = useMemo(() => getPageItems(user?.role), [user?.role]);

  const filteredPages = useMemo<PageSelectable[]>(() => {
    const pages = trimmedQuery ? fuzzyFilter(pageItems, query) : pageItems;
    return pages.map((p) => ({ ...p, ariaId: `cmdk-opt-${p.id}` }));
  }, [query, trimmedQuery, pageItems]);

  const filteredActions = useMemo<ActionSelectable[]>(() => {
    const actions = trimmedQuery
      ? fuzzyFilter(ACTION_ITEMS, query)
      : ACTION_ITEMS.filter((a) => a.showOnEmpty);
    return actions.map((a) => ({ ...a, ariaId: `cmdk-opt-${a.id}` }));
  }, [query, trimmedQuery]);

  // Show articles only when query ≥ 2 chars; keep stale list during refinement.
  const articleSelectables = useMemo<ArticleSelectable[]>(() => {
    if (trimmedQuery.length < 2 || (status === "loading" && articles.length === 0)) return [];
    return articles.map((a) => ({
      kind: "article" as const,
      ariaId: `cmdk-opt-article-${a.id}`,
      article: a,
    }));
  }, [trimmedQuery, status, articles]);

  const moreSelectable = useMemo<MoreSelectable | null>(() => {
    if (status !== "done" || !hasMore) return null;
    return { kind: "more" as const, ariaId: "cmdk-opt-more", offset: nextOffset };
  }, [status, hasMore, nextOffset]);

  const selectableItems = useMemo<SelectableItem[]>(() => {
    const items: SelectableItem[] = [
      ...filteredPages,
      ...filteredActions,
      ...articleSelectables,
    ];
    if (moreSelectable) items.push(moreSelectable);
    return items;
  }, [filteredPages, filteredActions, articleSelectables, moreSelectable]);

  const ariaIdToIndex = useMemo(
    () => new Map(selectableItems.map((item, i) => [item.ariaId, i])),
    [selectableItems],
  );

  const isLoading = status === "loading";
  const isFirstLoad = isLoading && articles.length === 0 && trimmedQuery.length >= 2;
  const showArticleGroup =
    trimmedQuery.length >= 2 &&
    (isLoading || (status === "done" && articles.length > 0) || status === "error");
  const hasNoResults =
    status === "done" &&
    trimmedQuery.length >= 2 &&
    filteredPages.length === 0 &&
    filteredActions.length === 0 &&
    articles.length === 0;

  return {
    filteredPages,
    filteredActions,
    articleSelectables,
    moreSelectable,
    selectableItems,
    ariaIdToIndex,
    status,
    articles,
    error,
    search,
    loadMore,
    isLoading,
    isFirstLoad,
    showArticleGroup,
    hasNoResults,
    trimmedQuery,
  };
}
