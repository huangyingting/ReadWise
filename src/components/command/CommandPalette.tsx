"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { Search, SearchX, FileText, X, AlertTriangle } from "lucide-react";
import { cn, focusRing } from "@/lib/cn";
import { Spinner } from "@/components/ui/Spinner";
import { Skeleton } from "@/components/ui/Skeleton";
import { CefrBadge, CEFR_LEVELS, type CefrLevel, CategoryBadge } from "@/components/ui/Badge";
import EmptyState from "@/components/EmptyState";
import { CATEGORIES } from "@/lib/categories";
import { getPageItems, ACTION_ITEMS, fuzzyFilter, type PageItem, type ActionItem } from "./command-items";
import { useArticleSearch } from "./useArticleSearch";
import type { ListingArticle } from "@/lib/articles";
import type { ShellUser } from "@/components/shell/types";

// ---- Selectable item shapes -------------------------------------------

type PageSelectable = PageItem & { ariaId: string };
type ActionSelectable = ActionItem & { ariaId: string };
type ArticleSelectable = { kind: "article"; ariaId: string; article: ListingArticle };
type MoreSelectable = { kind: "more"; ariaId: string; offset: number };
export type SelectableItem = PageSelectable | ActionSelectable | ArticleSelectable | MoreSelectable;

// ---- Option row (defined outside to keep a stable React component type) ------

interface OptionRowProps {
  item: SelectableItem;
  isActive: boolean;
  onActivate: () => void;
  onHover: () => void;
  children: React.ReactNode;
}

function OptionRow({ item, isActive, onActivate, onHover, children }: OptionRowProps) {
  return (
    <div
      id={item.ariaId}
      role="option"
      aria-selected={isActive}
      className={cn(
        "flex items-center gap-[var(--space-3)] w-full cursor-pointer",
        "min-h-[44px] px-[var(--space-3)] py-[var(--space-2)]",
        "rounded-[var(--radius-md)]",
        "transition-[background,box-shadow] [transition-duration:var(--duration-fast)]",
        "motion-reduce:transition-none",
        isActive && [
          "bg-[color-mix(in_srgb,var(--primary)_12%,transparent)]",
          "shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--primary)_30%,transparent)]",
        ],
      )}
      onMouseMove={onHover}
      onClick={onActivate}
    >
      {children}
    </div>
  );
}

// ---- Skeleton row for article loading state ---------------------------

function CommandResultSkeleton() {
  return (
    <div
      className="flex items-center gap-[var(--space-3)] px-[var(--space-3)] py-[var(--space-2)] min-h-[44px]"
      aria-hidden
    >
      <Skeleton shape="block" className="w-5 h-5 shrink-0 rounded-[var(--radius-sm)]" />
      <Skeleton shape="text" className="flex-1 h-4 max-w-[55%]" />
      <div className="hidden sm:flex gap-[var(--space-2)] shrink-0">
        <Skeleton shape="block" className="w-8 h-5 rounded-[var(--radius-full)]" />
        <Skeleton shape="block" className="w-14 h-5 rounded-[var(--radius-full)]" />
      </div>
    </div>
  );
}

// ---- Group header label -----------------------------------------------

function GroupHeader({ id, label, hasBorderTop }: { id: string; label: string; hasBorderTop: boolean }) {
  return (
    <li
      role="presentation"
      id={id}
      className={cn(hasBorderTop && "border-t border-border mt-[var(--space-1)]")}
    >
      <span className="block text-[length:var(--text-xs)] font-semibold uppercase tracking-wide text-text-subtle px-[var(--space-3)] py-[var(--space-1)] pt-[var(--space-2)]">
        {label}
      </span>
    </li>
  );
}

// ---- Article trailing meta -------------------------------------------

function ArticleMeta({ article }: { article: ListingArticle }) {
  const category = article.category
    ? CATEGORIES.find((c) => c.slug === article.category)?.label
    : null;
  const isCefr =
    article.difficulty != null &&
    (CEFR_LEVELS as readonly string[]).includes(article.difficulty);

  if (!isCefr && !category && article.readingMinutes == null) return null;

  return (
    <div
      className="hidden min-[380px]:flex items-center gap-[var(--space-2)] shrink-0 pointer-events-none"
      aria-hidden
    >
      {isCefr && <CefrBadge level={article.difficulty as CefrLevel} />}
      {category && <CategoryBadge>{category}</CategoryBadge>}
      {article.readingMinutes != null && (
        <span className="hidden sm:inline text-[length:var(--text-xs)] text-text-subtle whitespace-nowrap">
          {article.readingMinutes} min
        </span>
      )}
    </div>
  );
}

// ---- Main component --------------------------------------------------

export interface CommandPaletteProps {
  user: ShellUser | null;
  onClose: () => void;
  openerRef: React.RefObject<HTMLElement | null>;
}

export default function CommandPalette({ user, onClose, openerRef }: CommandPaletteProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [announcement, setAnnouncement] = useState("");

  const inputRef = useRef<HTMLInputElement>(null);
  const listboxRef = useRef<HTMLUListElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Stale-closure-safe refs
  const queryRef = useRef(query);
  queryRef.current = query;

  // ---- Search hook --------------------------------------------------------
  const { status, articles, hasMore, nextOffset, error, search, loadMore } = useArticleSearch();

  // ---- Item computation ---------------------------------------------------
  const pageItems = useMemo(() => getPageItems(user?.role), [user?.role]);

  const filteredPages = useMemo<PageSelectable[]>(() => {
    const pages = query.trim() ? fuzzyFilter(pageItems, query) : pageItems;
    return pages.map((p) => ({ ...p, ariaId: `cmdk-opt-${p.id}` }));
  }, [query, pageItems]);

  const filteredActions = useMemo<ActionSelectable[]>(() => {
    const actions = query.trim()
      ? fuzzyFilter(ACTION_ITEMS, query)
      : ACTION_ITEMS.filter((a) => a.showOnEmpty);
    return actions.map((a) => ({ ...a, ariaId: `cmdk-opt-${a.id}` }));
  }, [query]);

  // Show articles only when query ≥ 2 chars; keep stale list during refinement.
  const articleSelectables = useMemo<ArticleSelectable[]>(() => {
    if (query.trim().length < 2 || (status === "loading" && articles.length === 0)) return [];
    return articles.map((a) => ({
      kind: "article" as const,
      ariaId: `cmdk-opt-article-${a.id}`,
      article: a,
    }));
  }, [query, status, articles]);

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

  // Stale-closure-safe refs for keyboard handler
  const selectableItemsRef = useRef(selectableItems);
  selectableItemsRef.current = selectableItems;
  const activeIndexRef = useRef(activeIndex);
  activeIndexRef.current = activeIndex;

  const activeItem = selectableItems[activeIndex] ?? null;

  // Reset active index when query changes
  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  // ---- Focus management + scroll lock ------------------------------------
  useEffect(() => {
    const openerEl = openerRef.current;
    inputRef.current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
      // Restore focus to the element that opened the palette
      openerEl?.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Trigger search on query change ------------------------------------
  useEffect(() => {
    search(query);
  }, [query, search]);

  // ---- Live-region announcements (debounced) ----------------------------
  useEffect(() => {
    if (status !== "done") return;
    if (!query.trim() || query.trim().length < 2) return;
    const timer = setTimeout(() => {
      const total = filteredPages.length + filteredActions.length + articles.length;
      if (total === 0) {
        setAnnouncement("No results");
      } else {
        const parts: string[] = [];
        if (articles.length) parts.push(`${articles.length} article${articles.length !== 1 ? "s" : ""}`);
        if (filteredPages.length) parts.push(`${filteredPages.length} page${filteredPages.length !== 1 ? "s" : ""}`);
        setAnnouncement(parts.join(", "));
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [status, query, filteredPages.length, filteredActions.length, articles.length]);

  // ---- Scroll active row into view --------------------------------------
  const scrollActiveIntoView = useCallback((index: number) => {
    if (!listboxRef.current) return;
    const id = selectableItemsRef.current[index]?.ariaId;
    if (!id) return;
    const el = listboxRef.current.querySelector<HTMLElement>(`[id="${id}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, []);

  // ---- Activate item ----------------------------------------------------
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
        router.push(`/reader/${item.article.id}`);
        onClose();
      } else if (item.kind === "more") {
        loadMore(queryRef.current, item.offset);
        // Keep palette open for "Show more"
      }
    },
    [router, onClose, loadMore],
  );

  // ---- Keyboard handler -------------------------------------------------
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      switch (e.key) {
        case "Escape":
          e.preventDefault();
          onClose();
          break;

        case "ArrowDown": {
          e.preventDefault();
          const len = selectableItemsRef.current.length;
          if (len === 0) break;
          const next = activeIndexRef.current >= len - 1 ? 0 : activeIndexRef.current + 1;
          setActiveIndex(next);
          scrollActiveIntoView(next);
          break;
        }

        case "ArrowUp": {
          e.preventDefault();
          const len = selectableItemsRef.current.length;
          if (len === 0) break;
          const prev = activeIndexRef.current <= 0 ? len - 1 : activeIndexRef.current - 1;
          setActiveIndex(prev);
          scrollActiveIntoView(prev);
          break;
        }

        case "Home":
          e.preventDefault();
          setActiveIndex(0);
          scrollActiveIntoView(0);
          break;

        case "End": {
          e.preventDefault();
          const last = selectableItemsRef.current.length - 1;
          setActiveIndex(last);
          scrollActiveIntoView(last);
          break;
        }

        case "Enter": {
          e.preventDefault();
          const current = selectableItemsRef.current[activeIndexRef.current];
          if (current) activateItem(current);
          break;
        }

        case "Tab": {
          // Focus trap: cycle between input and the mobile close button (if present).
          if (!panelRef.current) break;
          const focusable = Array.from(
            panelRef.current.querySelectorAll<HTMLElement>(
              'input, button:not([disabled]), [tabindex]:not([tabindex="-1"])',
            ),
          );
          if (focusable.length <= 1) {
            e.preventDefault();
            break;
          }
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
          break;
        }
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose, activateItem, scrollActiveIntoView]);

  // ---- Derived state ----------------------------------------------------
  const isLoading = status === "loading";
  const trimmedQuery = query.trim();
  // First load: query ≥ 2 but no articles yet (show skeleton rows)
  const isFirstLoad = isLoading && articles.length === 0 && trimmedQuery.length >= 2;
  const showArticleGroup =
    trimmedQuery.length >= 2 && (isLoading || status === "done" || status === "error");
  const hasNoResults =
    status === "done" &&
    trimmedQuery.length >= 2 &&
    filteredPages.length === 0 &&
    filteredActions.length === 0 &&
    articles.length === 0;

  // ---- Render -----------------------------------------------------------
  return (
    <>
      {/* Scrim — desktop only (hidden on mobile; the sheet IS the full-screen surface) */}
      <div
        aria-hidden
        onClick={onClose}
        className="hidden sm:block fixed inset-0 z-[100] bg-[var(--overlay)] rw-cmdk-scrim"
        style={{ backdropFilter: "blur(2px)" }}
      />

      {/* Panel positioning container */}
      <div
        className={cn(
          "fixed inset-0 z-[101]",
          "sm:flex sm:justify-center sm:items-start",
          // Desktop: let clicks on the empty flex area pass through to the scrim
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
            // Layout
            "flex flex-col overflow-hidden",
            // Mobile: full-screen sheet
            "w-full bg-surface-raised",
            "h-[100dvh] max-h-none rounded-none",
            // Desktop: constrained panel, positioned high
            "sm:pointer-events-auto",
            "sm:mt-[12vh] sm:h-auto sm:max-h-[min(560px,70vh)]",
            "sm:w-[min(640px,calc(100vw-3rem))]",
            "sm:rounded-[var(--radius-xl)] sm:border sm:border-border sm:shadow-[var(--shadow-xl)]",
            "rw-cmdk-panel",
          )}
        >
          {/* ---- Input row ----------------------------------------- */}
          <div className="flex items-center gap-[var(--space-3)] px-[var(--space-4)] py-[var(--space-3)] border-b border-border shrink-0">
            {/* Leading: spinner when loading, search icon otherwise */}
            <span className="shrink-0 text-text-subtle" aria-hidden>
              {isLoading ? (
                <Spinner size="sm" label="Searching" className="text-text-subtle" />
              ) : (
                <Search size={20} />
              )}
            </span>

            {/* Combobox input */}
            <input
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
              className={cn(
                "flex-1 min-w-0 bg-transparent border-none outline-none ring-0",
                "text-[length:var(--text-lg)] text-text",
                "placeholder:text-text-subtle",
              )}
            />

            {/* Desktop: Esc hint chip */}
            <span
              className="hidden sm:inline-flex items-center gap-[var(--space-1)] shrink-0"
              aria-hidden
            >
              <span className="kbd">Esc</span>
            </span>

            {/* Mobile: Close button */}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close search"
              className={cn(
                "sm:hidden shrink-0 inline-flex items-center justify-center h-10 w-10",
                "rounded-[var(--radius-md)] text-text-subtle",
                "hover:text-text hover:bg-bg-subtle",
                "transition-colors [transition-duration:var(--duration-fast)]",
                focusRing,
              )}
            >
              <X size={20} aria-hidden />
            </button>
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
              <>
                <GroupHeader id="cmdk-grp-pages" label="Pages" hasBorderTop={false} />
                <li role="group" aria-labelledby="cmdk-grp-pages">
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
                </li>
              </>
            )}

            {/* Actions group */}
            {filteredActions.length > 0 && (
              <>
                <GroupHeader
                  id="cmdk-grp-actions"
                  label="Actions"
                  hasBorderTop={filteredPages.length > 0}
                />
                <li role="group" aria-labelledby="cmdk-grp-actions">
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
                </li>
              </>
            )}

            {/* Articles group */}
            {showArticleGroup && (
              <>
                <GroupHeader
                  id="cmdk-grp-articles"
                  label="Articles"
                  hasBorderTop={filteredPages.length > 0 || filteredActions.length > 0}
                />
                <li role="group" aria-labelledby="cmdk-grp-articles">
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
                  {!isFirstLoad && articleSelectables.map((item) => {
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
                  {moreSelectable && (() => {
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
                          className={cn("shrink-0 text-text-subtle", isActive && "text-primary-text")}
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
                </li>
              </>
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
