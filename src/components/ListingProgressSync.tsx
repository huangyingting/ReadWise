"use client";

import { useEffect } from "react";
import type { ProgressSummary } from "@/lib/progress";
import { clearVisitedArticleIds, getVisitedArticleIds } from "@/lib/visited";

type BatchResponse = {
  progress?: Record<string, ProgressSummary>;
};

function labelFor(summary: ProgressSummary): string {
  if (summary.completed) {
    return "Read";
  }
  return summary.percent > 0 ? `${summary.percent}% read` : "Not started";
}

function applyToCard(id: string, summary: ProgressSummary): void {
  const card = document.querySelector<HTMLElement>(
    `[data-article-id="${CSS.escape(id)}"]`,
  );
  if (!card) {
    return;
  }

  const bar = card.querySelector<HTMLElement>(".js-progress-bar");
  if (bar) {
    bar.setAttribute("aria-valuenow", String(summary.percent));
    const fill = bar.querySelector<HTMLElement>(".reading-progress-bar");
    if (fill) {
      fill.style.width = `${summary.percent}%`;
    }
  }

  const label = card.querySelector<HTMLElement>(".js-progress-label");
  if (label) {
    label.textContent = labelFor(summary);
  }

  const done = card.querySelector<HTMLElement>(".js-progress-done");
  if (done) {
    done.style.display = summary.completed ? "" : "none";
  }
}

/**
 * Refreshes reading-progress UI for articles the reader opened this session.
 * Server components already render saved progress on first load; after the
 * reader visits one or more articles this fetches just those ids in a SINGLE
 * batch request (no N+1) and merges the results into the existing cards. Only
 * visited articles present on the page are refreshed.
 */
export default function ListingProgressSync({
  articleIds,
}: {
  articleIds: string[];
}) {
  useEffect(() => {
    const onPage = new Set(articleIds);
    const toRefresh = getVisitedArticleIds().filter((id) => onPage.has(id));
    if (toRefresh.length === 0) {
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const res = await fetch("/api/progress/batch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: toRefresh }),
        });
        if (!res.ok || cancelled) {
          return;
        }
        const data = (await res.json()) as BatchResponse;
        const progress = data.progress ?? {};
        for (const id of toRefresh) {
          const summary = progress[id];
          if (summary) {
            applyToCard(id, summary);
          }
        }
        // These have been merged; don't refresh them again next navigation.
        clearVisitedArticleIds(toRefresh);
      } catch {
        /* best-effort refresh; SSR progress remains shown */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [articleIds]);

  return null;
}
