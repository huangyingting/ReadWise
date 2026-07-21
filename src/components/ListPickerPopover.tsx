"use client";

/**
 * ListPickerPopover — M10 list-picker dialog for the reader bookmark cluster.
 *
 * Renders a non-modal dialog (role="dialog", aria-modal="false") anchored
 * below the segment-B trigger. Shows all user lists with checkbox membership
 * indicators, plus an inline "New list…" create form.
 *
 * Accessibility:
 *   - Focus moves to first checkbox on open
 *   - Escape closes and returns focus to trigger
 *   - Outside-click closes
 *   - Checkbox semantics for membership; real <input type="checkbox">
 */

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  type RefObject,
} from "react";
import { Plus } from "lucide-react";
import { deleteJson, getJson, postJson } from "@/lib/client-fetch";
import { cn, focusRing } from "@/lib/cn";
import { markBookmarkChanged } from "@/lib/bookmarkChanges";
import { Button, PanelError, PanelFallback, PanelLoading } from "@/components/ui";
import { ListCreateForm } from "@/components/lists/ListCreateForm";

export type ListMembershipEntry = {
  id: string;
  name: string;
  isDefault: boolean;
  hasArticle: boolean;
};

type MembershipResponse = {
  lists?: ListMembershipEntry[];
};

type CreatedList = {
  id: string;
  name: string;
  isDefault: boolean;
};

type ListRowProps = {
  list: ListMembershipEntry;
  inputRef?: RefObject<HTMLInputElement | null>;
  onToggle: (list: ListMembershipEntry) => void;
};

interface ListPickerPopoverProps {
  id: string;
  articleId: string;
  triggerRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  /** Called when default-list membership changes (syncs segment A). */
  onDefaultListChange?: (saved: boolean) => void;
  /** Called once after membership data loads (used to detect named-list presence). */
  onMembershipLoaded?: (lists: ListMembershipEntry[]) => void;
}

function encodeId(id: string) {
  return encodeURIComponent(id);
}

function membershipUrl(articleId: string) {
  return `/api/bookmarks/membership?articleId=${encodeId(articleId)}`;
}

function listItemUrl(listId: string) {
  return `/api/lists/${encodeId(listId)}/items`;
}

function listArticleUrl(listId: string, articleId: string) {
  return `${listItemUrl(listId)}/${encodeId(articleId)}`;
}

function createdListMembership(newList: CreatedList): ListMembershipEntry {
  return {
    id: newList.id,
    name: newList.name,
    isDefault: newList.isDefault,
    hasArticle: true,
  };
}

function hasOnlyDefaultList(lists: ListMembershipEntry[]) {
  return lists.length === 1 && lists[0].isDefault;
}

function ListRow({ list, inputRef, onToggle }: ListRowProps) {
  return (
    <label
      className={cn(
        "flex items-center gap-[var(--space-2)]",
        "h-9 px-[var(--space-3)] w-full",
        "rounded-[var(--radius-md)] cursor-pointer",
        "hover:bg-bg-subtle",
        "text-[length:var(--text-sm)] text-text",
        focusRing,
      )}
    >
      <input
        ref={inputRef}
        type="checkbox"
        checked={list.hasArticle}
        onChange={() => onToggle(list)}
        className="accent-[var(--primary)] shrink-0"
        aria-label={list.name}
      />
      <span className="flex-1 truncate">{list.name}</span>
      {list.isDefault ? (
        <span className="text-[length:var(--text-xs)] text-text-subtle ml-auto shrink-0">
          (default)
        </span>
      ) : null}
    </label>
  );
}

export default function ListPickerPopover({
  id,
  articleId,
  triggerRef,
  onClose,
  onDefaultListChange,
  onMembershipLoaded,
}: ListPickerPopoverProps) {
  const [lists, setLists] = useState<ListMembershipEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);

  // Inline create state
  const [creating, setCreating] = useState(false);

  const popoverRef = useRef<HTMLDivElement>(null);
  const firstCheckRef = useRef<HTMLInputElement>(null);
  const createRowRef = useRef<HTMLButtonElement>(null);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const membershipEndpoint = membershipUrl(articleId);

  // Use ref so the callback never causes re-runs of the data-fetch effect
  const onMembershipLoadedRef = useRef(onMembershipLoaded);
  onMembershipLoadedRef.current = onMembershipLoaded;

  function setListMembership(listId: string, hasArticle: boolean) {
    setLists((prev) =>
      prev.map((list) =>
        list.id === listId ? { ...list, hasArticle } : list,
      ),
    );
  }

  function setTransientError(message: string) {
    setMutationError(message);
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    errorTimerRef.current = setTimeout(() => setMutationError(null), 3000);
  }

  const loadMembership = useCallback(
    async (isCancelled: () => boolean = () => false) => {
      setLoading(true);
      setLoadError(null);
      try {
        const data = await getJson<MembershipResponse>(
          membershipEndpoint,
        );
        if (isCancelled()) return;
        const loadedLists = data.lists ?? [];
        setLists(loadedLists);
        onMembershipLoadedRef.current?.(loadedLists);
      } catch {
        if (!isCancelled()) setLoadError("Couldn’t load lists.");
      } finally {
        if (!isCancelled()) setLoading(false);
      }
    },
    [membershipEndpoint],
  );

  // Load membership on mount
  useEffect(() => {
    let cancelled = false;
    void loadMembership(() => cancelled);

    return () => {
      cancelled = true;
    };
  }, [loadMembership]);

  // Clear the pending error-clear timer on unmount
  useEffect(() => {
    return () => {
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    };
  }, []);

  // Move focus to first checkbox (or new-list trigger) on load
  useEffect(() => {
    if (!loading) {
      firstCheckRef.current?.focus() ?? createRowRef.current?.focus();
    }
  }, [loading]);

  // Outside-click and Escape to close
  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
        triggerRef.current?.focus();
      }
    }

    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, triggerRef]);

  async function handleCheckbox(list: ListMembershipEntry) {
    const wasChecked = list.hasArticle;
    setListMembership(list.id, !wasChecked);

    try {
      if (wasChecked) {
        await deleteJson(listArticleUrl(list.id, articleId));
      } else {
        await postJson(listItemUrl(list.id), { articleId });
      }
      // Sync segment A if this was the default list
      if (list.isDefault) {
        onDefaultListChange?.(!wasChecked);
      }
      markBookmarkChanged(articleId);
    } catch {
      setListMembership(list.id, wasChecked);
      setTransientError("Couldn't update list — try again");
    }
  }

  function handleShowCreate() {
    setCreating(true);
  }

  function handleCancelCreate() {
    setCreating(false);
    createRowRef.current?.focus();
  }

  async function handleCreateSuccess(newList: CreatedList) {
    // Add article to the newly created list
    await postJson(listItemUrl(newList.id), { articleId });
    // Append to list with hasArticle=true
    setLists((prev) => [...prev, createdListMembership(newList)]);
    markBookmarkChanged(articleId);
    setCreating(false);
  }

  return (
    <div
      id={id}
      ref={popoverRef}
      role="dialog"
      aria-label="Add to list"
      aria-modal="false"
      className={cn(
        "absolute top-full right-0 mt-1",
        "bg-surface-raised border border-border rounded-[var(--radius-lg)] shadow-[var(--shadow-lg)]",
        "w-64 z-[var(--z-overlay)]",
        "rw-fade-up [transform-origin:top_right]",
      )}
    >
      {/* Header */}
      <div className="px-[var(--space-3)] py-[var(--space-2)] border-b border-border">
        <span className="text-[length:var(--text-sm)] font-semibold text-text">
          Add to list
        </span>
      </div>

      {/* List rows — scrollable */}
      <div
        className="max-h-60 overflow-y-auto py-[var(--space-1)] [scrollbar-color:var(--border)_transparent] [scrollbar-width:thin]"
      >
        {loading ? (
          <div className="px-[var(--space-3)] py-[var(--space-3)]">
            <PanelLoading message="Loading lists…" />
          </div>
        ) : loadError && lists.length === 0 ? (
          <div className="flex flex-col gap-[var(--space-3)] px-[var(--space-3)] py-[var(--space-3)]">
            <PanelFallback
              title="Lists couldn’t load"
              description="Retry to choose where this article should be saved."
            />
            <PanelError message={loadError} />
            <Button type="button" variant="secondary" size="sm" onClick={() => void loadMembership()}>
              Retry
            </Button>
          </div>
        ) : (
          <>
            {lists.map((list, idx) => (
              <ListRow
                key={list.id}
                list={list}
                inputRef={idx === 0 ? firstCheckRef : undefined}
                onToggle={(selectedList) => void handleCheckbox(selectedList)}
              />
            ))}

            {hasOnlyDefaultList(lists) ? (
              <p className="px-[var(--space-3)] py-[var(--space-1)] text-[length:var(--text-xs)] text-text-subtle">
                Create a list to organize saved articles.
              </p>
            ) : null}
          </>
        )}
      </div>

      {/* Error status */}
      {mutationError && lists.length > 0 ? (
        <div className="px-[var(--space-3)] py-[var(--space-1)]">
          <PanelError message={mutationError} />
        </div>
      ) : null}

      {/* Inline create */}
      <div className="border-t border-border py-[var(--space-1)] px-[var(--space-1)]">
        {creating ? (
          <ListCreateForm
            className="p-[var(--space-2)]"
            onSuccess={(list) => void handleCreateSuccess(list)}
            onCancel={handleCancelCreate}
          />
        ) : (
          <Button
            ref={createRowRef}
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleShowCreate}
            className={cn(
              "flex items-center gap-[var(--space-2)] w-full",
              "h-9 px-[var(--space-2)] rounded-[var(--radius-md)]",
              "text-[length:var(--text-sm)] text-text-muted hover:bg-bg-subtle hover:text-text",
              "transition-colors [transition-duration:var(--duration-fast)]",
            )}
          >
            <Plus size={16} aria-hidden />
            New list…
          </Button>
        )}
      </div>
    </div>
  );
}
