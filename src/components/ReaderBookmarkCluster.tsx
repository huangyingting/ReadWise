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
import { postJson } from "@/lib/client-fetch";
import { cn, focusRing } from "@/lib/cn";
import { Button, IconButton, Tooltip } from "@/components/ui";
import ListPickerPopover from "@/components/ListPickerPopover";
import { markBookmarkChanged } from "@/lib/bookmarkChanges";

const STATUS_MESSAGE_TIMEOUT_MS = 4000;

const SEGMENT_BASE_CLASSES = cn(
  "inline-flex items-center justify-center gap-[var(--space-2)] select-none whitespace-nowrap",
  "h-9 font-semibold text-[length:var(--text-sm)]",
  "border transition-[background-color,border-color,color,transform]",
  "[transition-duration:var(--duration-fast)] [transition-timing-function:var(--ease-standard)]",
  "active:translate-y-px motion-reduce:transform-none",
  focusRing,
);

const SAVED_SEGMENT_CLASSES = [
  "bg-[color-mix(in_srgb,var(--primary)_12%,transparent)]",
  "text-primary-text",
  "border-[color-mix(in_srgb,var(--primary)_38%,transparent)]",
  "hover:bg-[color-mix(in_srgb,var(--primary)_16%,transparent)]",
];

const UNSAVED_SEGMENT_CLASSES = [
  "bg-transparent text-text",
  "border-border-strong",
  "hover:bg-bg-subtle",
];

interface ReaderBookmarkClusterProps {
  articleId: string;
  initialSaved: boolean;
}

function segmentClasses(saved: boolean, shapeClasses: string) {
  return cn(
    SEGMENT_BASE_CLASSES,
    shapeClasses,
    saved ? SAVED_SEGMENT_CLASSES : UNSAVED_SEGMENT_CLASSES,
  );
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
      const data = await postJson<{ bookmarked: boolean }>("/api/bookmarks/toggle", {
        articleId,
      });
      setSaved(data.bookmarked);
      markBookmarkChanged(articleId);
    } catch {
      setSaved(prev); // revert
      setStatusMsg("Couldn't save — try again");
      setTimeout(() => setStatusMsg(null), STATUS_MESSAGE_TIMEOUT_MS);
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

  return (
    <div className="relative flex items-center ml-auto shrink-0" role="group" aria-label="Bookmark controls">
      {/* Segment A — default list toggle */}
      <Tooltip content={saved ? "Saved" : "Save"}>
        <Button
          variant="ghost"
          size="sm"
          aria-pressed={saved}
          aria-label="Save to reading list"
          onClick={() => void handleToggle()}
          leadingIcon={
            <Bookmark
              size={16}
              fill={saved ? "currentColor" : "none"}
              aria-hidden
              className={cn(
                "transition-transform [transition-duration:var(--duration-fast)]",
                saved && "rw-pop",
              )}
            />
          }
        className={segmentClasses(
          saved,
          "px-[var(--space-3)] rounded-l-[var(--radius-md)] rounded-r-none",
        )}
      >
        {saved ? "Saved" : "Save"}
        </Button>
      </Tooltip>

      {/* Segment B — list-picker trigger */}
      <IconButton
        ref={segBRef}
        aria-label="Add to list"
        aria-haspopup="dialog"
        aria-expanded={popoverOpen}
        aria-controls={popoverId}
        onClick={handleSegBClick}
        className={segmentClasses(
          saved,
          "relative w-9 rounded-r-[var(--radius-md)] rounded-l-none border-l-0",
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
      </IconButton>

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
