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
  useId,
  type RefObject,
} from "react";
import { Plus, Check } from "lucide-react";
import { deleteJson, getJson, postJson } from "@/lib/client-fetch";
import { cn, focusRing } from "@/lib/cn";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { markBookmarkChanged } from "@/lib/bookmarkChanges";

export type ListMembershipEntry = {
  id: string;
  name: string;
  isDefault: boolean;
  hasArticle: boolean;
};

type MembershipResponse = {
  lists?: ListMembershipEntry[];
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
  const [error, setError] = useState<string | null>(null);

  // Inline create state
  const [creating, setCreating] = useState(false);
  const [newListName, setNewListName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [createPending, setCreatePending] = useState(false);

  const popoverRef = useRef<HTMLDivElement>(null);
  const firstCheckRef = useRef<HTMLInputElement>(null);
  const newListInputRef = useRef<HTMLInputElement>(null);
  const createRowRef = useRef<HTMLButtonElement>(null);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statusId = useId();

  // Use ref so the callback never causes re-runs of the data-fetch effect
  const onMembershipLoadedRef = useRef(onMembershipLoaded);
  onMembershipLoadedRef.current = onMembershipLoaded;

  // Load membership on mount
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const data = await getJson<MembershipResponse>(
          `/api/bookmarks/membership?articleId=${encodeURIComponent(articleId)}`,
        );
        if (!cancelled) {
          const loadedLists = data.lists ?? [];
          setLists(loadedLists);
          onMembershipLoadedRef.current?.(loadedLists);
        }
      } catch {
        if (!cancelled) setError("Couldn't load lists");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [articleId]);

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
    // Optimistic update
    setLists((prev) =>
      prev.map((l) => (l.id === list.id ? { ...l, hasArticle: !l.hasArticle } : l)),
    );

    try {
      if (wasChecked) {
        await deleteJson(
          `/api/lists/${encodeURIComponent(list.id)}/items/${encodeURIComponent(articleId)}`,
        );
      } else {
        await postJson(`/api/lists/${encodeURIComponent(list.id)}/items`, { articleId });
      }
      // Sync segment A if this was the default list
      if (list.isDefault) {
        onDefaultListChange?.(!wasChecked);
      }
      markBookmarkChanged(articleId);
    } catch {
      // Revert
      setLists((prev) =>
        prev.map((l) => (l.id === list.id ? { ...l, hasArticle: wasChecked } : l)),
      );
      setError("Couldn't update list — try again");
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
      errorTimerRef.current = setTimeout(() => setError(null), 3000);
    }
  }

  function handleShowCreate() {
    setCreating(true);
    setNewListName("");
    setCreateError(null);
    setTimeout(() => newListInputRef.current?.focus(), 0);
  }

  async function handleCreate(e?: React.FormEvent) {
    e?.preventDefault();
    const trimmed = newListName.trim();
    if (!trimmed) {
      setCreateError("Name is required");
      return;
    }
    if (trimmed.length > 60) {
      setCreateError("Name must be 60 characters or less");
      return;
    }
    setCreatePending(true);
    setCreateError(null);

    try {
      // Create list
      const created = await postJson<{
        list: { id: string; name: string; isDefault: boolean };
      }>("/api/lists", { name: trimmed });
      const newList = created.list;

      // Add article to new list
      await postJson(`/api/lists/${encodeURIComponent(newList.id)}/items`, { articleId });

      // Append to list with hasArticle=true
      setLists((prev) => [
        ...prev,
        {
          id: newList.id,
          name: newList.name,
          isDefault: newList.isDefault,
          hasArticle: true,
        },
      ]);
      markBookmarkChanged(articleId);
      setCreating(false);
      setNewListName("");
    } catch {
      setCreateError("Couldn't create list — try again");
    } finally {
      setCreatePending(false);
    }
  }

  function handleCancelCreate() {
    setCreating(false);
    setNewListName("");
    setCreateError(null);
    createRowRef.current?.focus();
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
        "w-64 z-50",
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
        className="max-h-60 overflow-y-auto py-[var(--space-1)]"
        style={{ scrollbarWidth: "thin", scrollbarColor: "var(--border) transparent" }}
      >
        {loading ? (
          <div className="px-[var(--space-3)] py-[var(--space-3)] text-[length:var(--text-sm)] text-text-subtle">
            Loading…
          </div>
        ) : error && lists.length === 0 ? (
          <div className="px-[var(--space-3)] py-[var(--space-3)] text-[length:var(--text-sm)] text-danger-text">
            {error}
          </div>
        ) : (
          <>
            {lists.map((list, idx) => (
              <label
                key={list.id}
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
                  ref={idx === 0 ? firstCheckRef : undefined}
                  type="checkbox"
                  checked={list.hasArticle}
                  onChange={() => void handleCheckbox(list)}
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
            ))}

            {lists.length === 1 && lists[0].isDefault ? (
              <p className="px-[var(--space-3)] py-[var(--space-1)] text-[length:var(--text-xs)] text-text-subtle">
                Create a list to organize saved articles.
              </p>
            ) : null}
          </>
        )}
      </div>

      {/* Error status */}
      {error && lists.length > 0 ? (
        <p
          id={statusId}
          role="status"
          aria-live="polite"
          className="px-[var(--space-3)] py-[var(--space-1)] text-[length:var(--text-xs)] text-danger-text"
        >
          {error}
        </p>
      ) : null}

      {/* Inline create */}
      <div className="border-t border-border py-[var(--space-1)] px-[var(--space-1)]">
        {creating ? (
          <form onSubmit={(e) => void handleCreate(e)} className="flex flex-col gap-[var(--space-1)] p-[var(--space-2)]">
            <Input
              ref={newListInputRef}
              inputSize="sm"
              placeholder="List name…"
              value={newListName}
              maxLength={60}
              onChange={(e) => setNewListName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") handleCancelCreate();
              }}
              aria-label="New list name"
              invalid={createError ? true : false}
            />
            {createError ? (
              <p className="text-[length:var(--text-xs)] text-danger-text m-0">
                {createError}
              </p>
            ) : null}
            <div className="flex gap-[var(--space-1)]">
              <Button
                type="submit"
                size="sm"
                variant="primary"
                loading={createPending}
                disabled={!newListName.trim()}
                leadingIcon={<Check size={14} aria-hidden />}
              >
                Create
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={createPending}
                onClick={handleCancelCreate}
              >
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <button
            ref={createRowRef}
            type="button"
            onClick={handleShowCreate}
            className={cn(
              "flex items-center gap-[var(--space-2)] w-full",
              "h-9 px-[var(--space-2)] rounded-[var(--radius-md)]",
              "text-[length:var(--text-sm)] text-text-muted hover:bg-bg-subtle hover:text-text",
              "transition-colors [transition-duration:var(--duration-fast)]",
              focusRing,
            )}
          >
            <Plus size={16} aria-hidden />
            New list…
          </button>
        )}
      </div>
    </div>
  );
}
