"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, SearchX, FileText, X, AlertTriangle } from "lucide-react";
import { cn, focusRing } from "@/lib/cn";
import { setReaderReferrer } from "@/lib/reader-referrer";
import { IconButton, Input, Spinner } from "@/components/ui";
import EmptyState from "@/components/EmptyState";
import type { ShellUser } from "@/components/shell/types";
import type { SelectableItem } from "./command-items";
import { useCommandPaletteSearch } from "./useCommandPaletteSearch";
import { useCommandNavigation } from "./useCommandNavigation";
import { useCommandPaletteDialog } from "./useCommandPaletteDialog";
import {
  OptionRow,
  CommandResultSkeleton,
  CommandGroup,
  ArticleMeta,
} from "./CommandPaletteItems";

// ---- Props ---------------------------------------------------------------

export interface CommandPaletteProps {
  user: ShellUser | null;
  onClose: () => void;
  openerRef: React.RefObject<HTMLElement | null>;
}

// ---- Main component ------------------------------------------------------

export default function CommandPalette({ user, onClose, openerRef }: CommandPaletteProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [announcement, setAnnouncement] = useState("");

  const inputRef = useRef<HTMLInputElement>(null);
  const listboxRef = useRef<HTMLUListElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Stale-closure-safe ref so keyboard handlers always see the latest query.
  const queryRef = useRef(query);
  queryRef.current = query;

  // ---- Search + item derivation ----------------------------------------
  const {
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
  } = useCommandPaletteSearch({ user, query });

  // ---- Dialog focus + body scroll lock ---------------------------------
  useCommandPaletteDialog(inputRef, openerRef);

  // ---- Trigger article search on query change --------------------------
  useEffect(() => {
    search(query);
  }, [query, search]);

  // ---- Activate item ---------------------------------------------------
  const activateItem = useCallback(
    (item: SelectableItem) => {
      if (item.kind === "page") {
        router.push(item.href);
        onClose();
      } else if (item.kind === "action") {
        if (item.href) {
          router.push(item.href);
        } else if (item.run) {
          item.run();
        }
        onClose();
      } else if (item.kind === "article") {
        // Record the search origin so the reader's Back button returns here
        // instead of always the dashboard.
        setReaderReferrer({
          href: window.location.pathname + window.location.search,
          label: "Search",
        });
        router.push(`/reader/${item.article.id}`);
        onClose();
      } else if (item.kind === "more") {
        loadMore(queryRef.current, item.offset);
        // Keep palette open after "Show more".
      }
    },
    [router, onClose, loadMore],
  );

  // ---- Keyboard navigation + focus trap --------------------------------
  const { activeIndex, setActiveIndex } = useCommandNavigation({
    items: selectableItems,
    onClose,
    onActivate: activateItem,
    listboxRef,
    panelRef,
  });

  // Reset active index when query changes.
  useEffect(() => {
    setActiveIndex(0);
  }, [query, setActiveIndex]);

  // ---- Live-region announcements (debounced) ---------------------------
  useEffect(() => {
    if (status !== "done") return;
    if (!trimmedQuery || trimmedQuery.length < 2) return;
    const timer = setTimeout(() => {
      const total =
        filteredPages.length + filteredActions.length + articles.length;
      if (total === 0) {
        setAnnouncement("No results");
      } else {
        const parts: string[] = [];
        if (articles.length)
          parts.push(`${articles.length} article${articles.length !== 1 ? "s" : ""}`);
        if (filteredPages.length)
          parts.push(`${filteredPages.length} page${filteredPages.length !== 1 ? "s" : ""}`);
        setAnnouncement(parts.join(", "));
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [status, trimmedQuery, filteredPages.length, filteredActions.length, articles.length]);

  const activeItem = selectableItems[activeIndex] ?? null;

  // ---- Render ----------------------------------------------------------
  return (
    <>
      {/* Scrim — desktop only */}
      <div
        aria-hidden
        onClick={onClose}
        className="hidden sm:block fixed inset-0 z-[var(--z-scrim)] bg-[var(--overlay)] rw-cmdk-scrim"
        style={{ backdropFilter: "blur(2px)" }}
      />

      {/* Panel positioning container */}
      <div
        className={cn(
          "fixed inset-0 z-[var(--z-modal)]",
          "sm:flex sm:justify-center sm:items-start",
          "sm:pointer-events-none",
        )}
      >
        {/* Dialog panel */}
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Search and commands"
          ref={panelRef}
          className={cn(
            "flex flex-col overflow-hidden",
            "w-full bg-surface-raised",
            "h-[100dvh] max-h-none rounded-none",
            "sm:pointer-events-auto",
            "sm:mt-[12vh] sm:h-auto sm:max-h-[min(560px,70vh)]",
            "sm:w-[min(640px,calc(100vw-3rem))]",
            "sm:rounded-[var(--radius-xl)] sm:border sm:border-border sm:shadow-[var(--shadow-xl)]",
            "rw-cmdk-panel",
          )}
        >
          {/* ---- Input row ----------------------------------------- */}
          <div className="flex items-center gap-[var(--space-3)] px-[var(--space-4)] py-[var(--space-3)] border-b border-border shrink-0">
            <span className="shrink-0 text-text-subtle" aria-hidden>
              {isLoading ? (
                <Spinner size="sm" label="Searching" className="text-text-subtle" />
              ) : (
                <Search size={20} />
              )}
            </span>

            <Input
              ref={inputRef}
              role="combobox"
              aria-expanded={true}
              aria-controls="cmdk-listbox"
              aria-activedescendant={activeItem?.ariaId ?? undefined}
              aria-autocomplete="list"
              aria-label="Search articles, pages, and actions"
              type="text"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              enterKeyHint="go"
              placeholder="Search articles, pages, actions…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="min-w-0 flex-1 border-none bg-transparent text-[length:var(--text-lg)] shadow-none ring-0 placeholder:text-text-subtle"
            />

            {/* Desktop: Esc hint chip */}
            <span
              className="hidden sm:inline-flex items-center gap-[var(--space-1)] shrink-0"
              aria-hidden
            >
              <span className="kbd">Esc</span>
            </span>

            {/* Mobile: Close button */}
            <IconButton
              onClick={onClose}
              aria-label="Close search"
              className="h-10 w-10 rounded-[var(--radius-md)] text-text-subtle hover:text-text sm:hidden"
            >
              <X size={20} aria-hidden />
            </IconButton>
          </div>

          {/* ---- Results list -------------------------------------- */}
          <ul
            id="cmdk-listbox"
            ref={listboxRef}
            role="listbox"
            aria-label="Results"
            className="flex-1 overflow-y-auto p-[var(--space-2)] min-h-0"
          >
            {/* No results */}
            {hasNoResults && (
              <li role="presentation">
                <EmptyState
                  icon={SearchX}
                  title={`No results for "${trimmedQuery}"`}
                  description="Try a different title, topic, or author — or jump to a page above."
                  className="py-[var(--space-8)] col-span-1 border-none bg-transparent"
                />
              </li>
            )}

            {/* Pages group */}
            {filteredPages.length > 0 && (
              <CommandGroup id="cmdk-grp-pages" label="Pages" hasBorderTop={false}>
                {filteredPages.map((item) => {
                    const idx = ariaIdToIndex.get(item.ariaId) ?? -1;
                    const isActive = idx === activeIndex;
                    return (
                      <OptionRow
                        key={item.ariaId}
                        item={item}
                        isActive={isActive}
                        onActivate={() => activateItem(item)}
                        onHover={() => { if (idx !== -1) setActiveIndex(idx); }}
                      >
                        <item.icon
                          size={20}
                          aria-hidden
                          className={cn(
                            "shrink-0 text-text-subtle",
                            isActive && "text-primary-text",
                          )}
                        />
                        <span
                          className={cn(
                            "flex-1 truncate text-[length:var(--text-sm)] text-text",
                            isActive && "text-primary-text",
                          )}
                        >
                          {item.label}
                        </span>
                        <span
                          className={cn(
                            "shrink-0 text-[length:var(--text-xs)] text-text-subtle",
                            isActive && "text-primary-text",
                          )}
                          aria-hidden
                        >
                          →
                        </span>
                      </OptionRow>
                    );
                  })}
              </CommandGroup>
            )}

            {/* Actions group */}
            {filteredActions.length > 0 && (
              <CommandGroup
                id="cmdk-grp-actions"
                label="Actions"
                hasBorderTop={filteredPages.length > 0}
              >
                {filteredActions.map((item) => {
                    const idx = ariaIdToIndex.get(item.ariaId) ?? -1;
                    const isActive = idx === activeIndex;
                    return (
                      <OptionRow
                        key={item.ariaId}
                        item={item}
                        isActive={isActive}
                        onActivate={() => activateItem(item)}
                        onHover={() => { if (idx !== -1) setActiveIndex(idx); }}
                      >
                        <item.icon
                          size={20}
                          aria-hidden
                          className={cn(
                            "shrink-0 text-text-subtle",
                            isActive && "text-primary-text",
                          )}
                        />
                        <span
                          className={cn(
                            "flex-1 truncate text-[length:var(--text-sm)] text-text",
                            isActive && "text-primary-text",
                          )}
                        >
                          {item.label}
                        </span>
                      </OptionRow>
                    );
                  })}
              </CommandGroup>
            )}

            {/* Articles group */}
            {showArticleGroup && (
              <CommandGroup
                id="cmdk-grp-articles"
                label="Articles"
                hasBorderTop={filteredPages.length > 0 || filteredActions.length > 0}
              >
                {/* Error state */}
                  {status === "error" && (
                    <div
                      role="option"
                      id="cmdk-opt-error"
                      aria-selected={false}
                      className={cn(
                        "flex items-center gap-[var(--space-3)]",
                        "min-h-[44px] px-[var(--space-3)] py-[var(--space-2)]",
                        "rounded-[var(--radius-md)] cursor-pointer",
                        "hover:bg-bg-subtle",
                        focusRing,
                      )}
                      tabIndex={0}
                      onClick={() => search(query)}
                      onKeyDown={(e) => { if (e.key === "Enter") search(query); }}
                    >
                      <AlertTriangle size={20} className="shrink-0 text-danger-text" aria-hidden />
                      <span className="text-[length:var(--text-sm)] text-text-muted">
                        {error ?? "Couldn't load articles."} Press Enter to retry.
                      </span>
                    </div>
                  )}

                  {/* Skeleton rows on first load */}
                  {isFirstLoad && (
                    <>
                      <CommandResultSkeleton />
                      <CommandResultSkeleton />
                      <CommandResultSkeleton />
                    </>
                  )}

                  {/* Article rows (fresh or stale during refinement) */}
                  {!isFirstLoad &&
                    articleSelectables.map((item) => {
                      const idx = ariaIdToIndex.get(item.ariaId) ?? -1;
                      const isActive = idx === activeIndex;
                      return (
                        <OptionRow
                          key={item.ariaId}
                          item={item}
                          isActive={isActive}
                          onActivate={() => activateItem(item)}
                          onHover={() => { if (idx !== -1) setActiveIndex(idx); }}
                        >
                          <FileText
                            size={20}
                            aria-hidden
                            className={cn(
                              "shrink-0 text-text-subtle",
                              isActive && "text-primary-text",
                            )}
                          />
                          <span
                            className={cn(
                              "flex-1 truncate text-[length:var(--text-sm)] text-text",
                              isActive && "text-primary-text",
                            )}
                          >
                            {item.article.title}
                          </span>
                          <ArticleMeta article={item.article} />
                        </OptionRow>
                      );
                    })}

                  {/* "Show more results" row */}
                  {moreSelectable &&
                    (() => {
                      const idx = ariaIdToIndex.get(moreSelectable.ariaId) ?? -1;
                      const isActive = idx === activeIndex;
                      return (
                        <OptionRow
                          item={moreSelectable}
                          isActive={isActive}
                          onActivate={() => activateItem(moreSelectable)}
                          onHover={() => { if (idx !== -1) setActiveIndex(idx); }}
                        >
                          <Search
                            size={20}
                            aria-hidden
                            className={cn(
                              "shrink-0 text-text-subtle",
                              isActive && "text-primary-text",
                            )}
                          />
                          <span
                            className={cn(
                              "flex-1 text-[length:var(--text-sm)] text-text-muted",
                              isActive && "text-primary-text",
                            )}
                          >
                            Show more results
                          </span>
                        </OptionRow>
                      );
                    })()}
              </CommandGroup>
            )}
          </ul>

          {/* ---- Footer hint (desktop only) */}
          <div
            className="hidden sm:flex items-center px-[var(--space-4)] py-[var(--space-2)] border-t border-border shrink-0"
            aria-hidden
          >
            <span className="text-[length:var(--text-xs)] text-text-subtle">
              ↑↓ navigate · ↵ select · esc close
            </span>
          </div>
        </div>
      </div>

      {/* Live region for screen-reader announcements */}
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </div>
    </>
  );
}
