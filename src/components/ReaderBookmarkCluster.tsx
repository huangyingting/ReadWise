"use client";

/**
 * ReaderBookmarkCluster — M10 split-pill bookmark control for the reader.
 *
 * Anatomy (two-segment bordered pill):
 *   ┌──────────────────────────────────┬─────┐
 *   │  🔖  Save / Saved  (toggle)      │  ＋ │   ← ListPlus opens list-picker
 *   └──────────────────────────────────┴─────┘
 *      Segment A: default-list toggle      Segment B: "Add to list…"
 *
 * Segment A: quick-toggle via POST /api/bookmarks/toggle. Optimistic fill
 * swap; reverts on error and shows a role="status" inline message.
 *
 * Segment B: opens <ListPickerPopover> (a non-modal dialog) for per-list
 * membership management.
 *
 * Placed at the RIGHT end of .reader-meta via ml-auto.
 */

import { useState, useRef, useId, useCallback } from "react";
import { Bookmark, ListPlus } from "lucide-react";
import { cn, focusRing } from "@/lib/cn";
import ListPickerPopover from "@/components/ListPickerPopover";
import { markBookmarkChanged } from "@/lib/bookmarkChanges";

interface ReaderBookmarkClusterProps {
  articleId: string;
  initialSaved: boolean;
}

export default function ReaderBookmarkCluster({
  articleId,
  initialSaved,
}: ReaderBookmarkClusterProps) {
  const [saved, setSaved] = useState(initialSaved);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [segBHasNamedList, setSegBHasNamedList] = useState(false);

  const segBRef = useRef<HTMLButtonElement>(null);
  const popoverId = useId();
  const statusId = useId();

  const handleToggle = useCallback(async () => {
    const prev = saved;
    setSaved(!prev); // optimistic
    setStatusMsg(null);

    try {
      const res = await fetch("/api/bookmarks/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ articleId }),
      });
      if (!res.ok) throw new Error("Failed");
      const data = (await res.json()) as { bookmarked: boolean };
      setSaved(data.bookmarked);
      markBookmarkChanged(articleId);
    } catch {
      setSaved(prev); // revert
      setStatusMsg("Couldn't save — try again");
      setTimeout(() => setStatusMsg(null), 4000);
    }
  }, [saved, articleId]);

  const handleSegBClick = useCallback(() => {
    setPopoverOpen((v) => !v);
  }, []);

  // Called by ListPickerPopover when default-list membership changes (keeps A in sync)
  const handleDefaultListChange = useCallback((newSaved: boolean) => {
    setSaved(newSaved);
    markBookmarkChanged(articleId);
  }, [articleId]);

  // Detect whether article is in any named (non-default) list — the indigo dot indicator
  const handleMembershipLoaded = useCallback(
    (lists: { isDefault: boolean; hasArticle: boolean }[]) => {
      setSegBHasNamedList(lists.some((l) => !l.isDefault && l.hasArticle));
    },
    [],
  );

  // Segment A shared base classes
  const segBase = cn(
    "inline-flex items-center justify-center gap-[var(--space-2)] select-none whitespace-nowrap",
    "h-9 font-semibold text-[length:var(--text-sm)]",
    "border transition-[background-color,border-color,color,transform]",
    "[transition-duration:var(--duration-fast)] [transition-timing-function:var(--ease-standard)]",
    "active:translate-y-px motion-reduce:transform-none",
    focusRing,
  );

  return (
    <div className="relative flex items-center ml-auto shrink-0" role="group" aria-label="Bookmark controls">
      {/* Segment A — default list toggle */}
      <button
        type="button"
        aria-pressed={saved}
        aria-label="Save to reading list"
        title={saved ? "Saved" : "Save"}
        onClick={() => void handleToggle()}
        className={cn(
          segBase,
          "px-[var(--space-3)] rounded-l-[var(--radius-md)] rounded-r-none",
          saved
            ? [
                "bg-[color-mix(in_srgb,var(--primary)_12%,transparent)]",
                "text-primary-text",
                "border-[color-mix(in_srgb,var(--primary)_38%,transparent)]",
                "hover:bg-[color-mix(in_srgb,var(--primary)_16%,transparent)]",
              ]
            : [
                "bg-transparent text-text",
                "border-border-strong",
                "hover:bg-bg-subtle",
              ],
        )}
      >
        <Bookmark
          size={16}
          fill={saved ? "currentColor" : "none"}
          aria-hidden
          className={cn(
            "transition-transform [transition-duration:var(--duration-fast)]",
            saved && "rw-pop",
          )}
        />
        {saved ? "Saved" : "Save"}
      </button>

      {/* Segment B — list-picker trigger */}
      <button
        ref={segBRef}
        type="button"
        aria-label="Add to list"
        aria-haspopup="dialog"
        aria-expanded={popoverOpen}
        aria-controls={popoverId}
        onClick={handleSegBClick}
        className={cn(
          segBase,
          "relative w-9 rounded-r-[var(--radius-md)] rounded-l-none border-l-0",
          saved
            ? [
                "bg-[color-mix(in_srgb,var(--primary)_12%,transparent)]",
                "text-primary-text",
                "border-[color-mix(in_srgb,var(--primary)_38%,transparent)]",
                "hover:bg-[color-mix(in_srgb,var(--primary)_16%,transparent)]",
              ]
            : [
                "bg-transparent text-text",
                "border-border-strong",
                "hover:bg-bg-subtle",
              ],
        )}
      >
        <ListPlus size={16} aria-hidden />
        {/* Indigo dot: article is in a named list */}
        {segBHasNamedList ? (
          <span
            aria-hidden
            className="absolute top-1 right-1 size-1.5 rounded-full bg-primary"
          />
        ) : null}
      </button>

      {/* List-picker popover */}
      {popoverOpen ? (
        <ListPickerPopover
          id={popoverId}
          articleId={articleId}
          triggerRef={segBRef}
          onClose={() => setPopoverOpen(false)}
          onDefaultListChange={handleDefaultListChange}
          onMembershipLoaded={handleMembershipLoaded}
        />
      ) : null}

      {/* Error live region */}
      {statusMsg ? (
        <span
          id={statusId}
          role="status"
          aria-live="polite"
          className="absolute top-full left-0 mt-1 text-[length:var(--text-xs)] text-danger-text whitespace-nowrap"
        >
          {statusMsg}
        </span>
      ) : null}
    </div>
  );
}
