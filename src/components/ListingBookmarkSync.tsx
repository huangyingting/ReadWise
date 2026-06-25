"use client";

/**
 * ListingBookmarkSync — M10 parallel to ListingProgressSync.
 *
 * On mount, refreshes the saved-indicator state for articles whose bookmark
 * state changed during this session (tracked in sessionStorage by
 * CardBookmarkButton and ReaderBookmarkCluster). Only articles that are BOTH
 * in the changed set AND present on the current page are queried — a single
 * POST /api/saved request handles all of them.
 *
 * DOM contract:
 *   - Finds card wrapper via `[data-article-id="<id>"]`
 *   - Within the wrapper, finds the bookmark button via `.js-bookmark`
 *   - Sets/removes `data-saved` attribute on the button (triggers CSS state)
 *   - Updates `aria-pressed` for screen readers
 *
 * ⚠️ SEPARATE file from ListingProgressSync — must not entangle the progress
 * sync contract.
 */

import { useEffect } from "react";
import { getBookmarkChangedIds, clearBookmarkChangedIds } from "@/lib/bookmarkChanges";

type SavedResponse = {
  bookmarked?: string[];
};

function applyToCard(id: string, isSaved: boolean): void {
  const card = document.querySelector<HTMLElement>(
    `[data-article-id="${CSS.escape(id)}"]`,
  );
  if (!card) {
    return;
  }

  const btn = card.querySelector<HTMLElement>(".js-bookmark");
  if (!btn) {
    return;
  }

  // Update data-saved attribute (drives CSS-based visual state)
  if (isSaved) {
    btn.setAttribute("data-saved", "true");
  } else {
    btn.removeAttribute("data-saved");
  }

  // Update aria-pressed (only for toggle buttons — remove-mode buttons have none)
  if (btn.hasAttribute("aria-pressed")) {
    btn.setAttribute("aria-pressed", String(isSaved));
  }
}

/**
 * Refreshes bookmark saved-indicator for articles whose bookmark state
 * changed this session. Server-rendered state is already correct on first
 * paint; this only updates cards when the router serves a cached page.
 */
export default function ListingBookmarkSync({
  articleIds,
}: {
  articleIds: string[];
}) {
  useEffect(() => {
    const onPage = new Set(articleIds);
    const toRefresh = getBookmarkChangedIds().filter((id) => onPage.has(id));
    if (toRefresh.length === 0) {
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        // batch DOM sync: not a user mutation, uses raw fetch for non-interactive state sync
        const res = await fetch("/api/saved", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: toRefresh }),
        });
        if (!res.ok || cancelled) {
          return;
        }
        const data = (await res.json()) as SavedResponse;
        const bookmarkedSet = new Set(data.bookmarked ?? []);
        for (const id of toRefresh) {
          applyToCard(id, bookmarkedSet.has(id));
        }
        // Merged — don't re-refresh on next navigation
        clearBookmarkChangedIds(toRefresh);
      } catch {
        /* best-effort refresh; SSR saved state remains shown */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [articleIds]);

  return null;
}
