"use client";

/**
 * CardBookmarkButton — M10 card overlay bookmark affordance.
 *
 * Absolutely-positioned sibling of the ArticleCardView <Link>. Toggles the
 * article in the user's default "Saved" list (or removes from a specific named
 * list when removeListId is provided).
 *
 * DOM contract (for ListingBookmarkSync):
 *   - Has class `.js-bookmark`
 *   - Sets `data-saved="true"` when saved; removes the attribute when unsaved
 *   - Has `aria-pressed` (toggle mode) or none (remove mode)
 *
 * CSS hooks (in globals.css):
 *   - `.js-bookmark[data-saved="true"] svg { fill: currentColor; }`
 *
 * ⚠️ MUST be rendered as an absolute-positioned SIBLING of the card <Link>,
 * never nested inside it (invalid HTML + intercepted navigation).
 */

import { useState, useRef, useEffect } from "react";
import { Bookmark } from "lucide-react";
import { deleteJson, postJson } from "@/lib/client-fetch";
import { cn, focusRing } from "@/lib/cn";
import { markBookmarkChanged } from "@/lib/bookmarkChanges";

export interface CardBookmarkButtonProps {
  articleId: string;
  articleTitle: string;
  initialSaved?: boolean;
  /**
   * When provided, clicking removes from this specific list instead of
   * toggling the default "Saved" list. Used on the /lists page.
   */
  removeListId?: string;
  removeListName?: string;
}

export default function CardBookmarkButton({
  articleId,
  articleTitle,
  initialSaved = false,
  removeListId,
  removeListName,
}: CardBookmarkButtonProps) {
  const [saved, setSaved] = useState(initialSaved);
  const [pending, setPending] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const isRemoveMode = Boolean(removeListId);

  // Keep data-saved attribute in sync with React state for ListingBookmarkSync
  useEffect(() => {
    const el = buttonRef.current;
    if (!el) return;
    if (saved) {
      el.setAttribute("data-saved", "true");
    } else {
      el.removeAttribute("data-saved");
    }
  }, [saved]);

  async function handleClick(e: React.MouseEvent) {
    e.preventDefault();
    if (pending) return;
    setPending(true);

    if (isRemoveMode && removeListId) {
      // Remove from specific list — animate card out via data attribute on wrapper
      const wrapper = buttonRef.current?.closest<HTMLElement>("[data-card-wrapper]");
      try {
        await deleteJson(
          `/api/lists/${encodeURIComponent(removeListId)}/items/${encodeURIComponent(articleId)}`,
        );
        // Trigger CSS fade-out on the card wrapper
        wrapper?.setAttribute("data-card-removed", "true");
      } catch {
        // silent — card stays visible
      } finally {
        setPending(false);
      }
    } else {
      // Toggle default list — optimistic fill swap
      const newSaved = !saved;
      setSaved(newSaved);

      try {
        const data = await postJson<{ bookmarked: boolean }>("/api/bookmarks/toggle", {
          articleId,
        });
        setSaved(data.bookmarked);
        markBookmarkChanged(articleId);
      } catch {
        setSaved(!newSaved); // revert
      } finally {
        setPending(false);
      }
    }
  }

  const ariaLabel = isRemoveMode
    ? `Remove "${articleTitle}" from ${removeListName ?? "list"}`
    : `Save "${articleTitle}"`;

  return (
    <button
      ref={buttonRef}
      type="button"
      // aria-pressed only for toggle mode (not remove mode)
      aria-pressed={isRemoveMode ? undefined : saved}
      aria-label={ariaLabel}
      title={ariaLabel}
      disabled={pending}
      // data-saved attribute drives CSS state for both React renders and
      // DOM-only updates from ListingBookmarkSync
      data-saved={saved ? "true" : undefined}
      className={cn(
        "js-bookmark",
        // Position: absolute sibling overlay, top-right corner
        "absolute top-[var(--space-3)] right-[var(--space-3)] z-10",
        "inline-flex items-center justify-center",
        // Visual: 32px target; expanded touch via padding
        "size-8 rounded-[var(--radius-full)] p-1.5",
        "border shadow-[var(--shadow-sm)]",
        // Transitions
        "transition-[opacity,background-color,border-color,color]",
        "[transition-duration:var(--duration-base)] [transition-timing-function:var(--ease-standard)]",
        "motion-reduce:transition-none",
        "disabled:pointer-events-none",
        // Unsaved base state: hidden, revealed on card hover/button focus
        "opacity-0 group-hover/card:opacity-100 focus-visible:opacity-100",
        "bg-surface/80 backdrop-blur-sm text-text-subtle border-border",
        // Saved state overrides via data attribute (also used by ListingBookmarkSync)
        "data-[saved=true]:opacity-100",
        "data-[saved=true]:text-primary-text",
        "data-[saved=true]:bg-[color-mix(in_srgb,var(--primary)_10%,transparent)]",
        "data-[saved=true]:border-[color-mix(in_srgb,var(--primary)_38%,transparent)]",
        focusRing,
      )}
      onClick={handleClick}
    >
      <Bookmark
        size={16}
        fill={saved ? "currentColor" : "none"}
        aria-hidden
      />
    </button>
  );
}
