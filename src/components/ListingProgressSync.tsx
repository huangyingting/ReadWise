"use client";

import { useEffect } from "react";
import type { ProgressSummary } from "@/lib/engagement";
import { clearVisitedArticleIds, getVisitedArticleIds } from "@/lib/visited";

type BatchResponse = {
  progress?: Record<string, ProgressSummary>;
};

const BATCH_PROGRESS_ENDPOINT = "/api/progress/batch";
const ARTICLE_CARD_SELECTOR = (id: string) =>
  `[data-article-id="${CSS.escape(id)}"]`;
const PROGRESS_BAR_SELECTOR = ".js-progress-bar";
const PROGRESS_FILL_SELECTOR = ".reading-progress-bar";
const PROGRESS_LABEL_SELECTOR = ".js-progress-label";
const PROGRESS_DONE_SELECTOR = ".js-progress-done";

function labelFor(summary: ProgressSummary): string {
  if (summary.completed) {
    return "Read";
  }
  return summary.percent > 0 ? `${summary.percent}% read` : "Not started";
}

function getIdsToRefresh(articleIds: string[]): string[] {
  const onPage = new Set(articleIds);
  return getVisitedArticleIds().filter((id) => onPage.has(id));
}

function setProgressBar(card: HTMLElement, summary: ProgressSummary): void {
  const bar = card.querySelector<HTMLElement>(PROGRESS_BAR_SELECTOR);
  if (!bar) {
    return;
  }

  bar.setAttribute("aria-valuenow", String(summary.percent));
  const fill = bar.querySelector<HTMLElement>(PROGRESS_FILL_SELECTOR);
  if (fill) {
    fill.style.width = `${summary.percent}%`;
  }
}

function setProgressLabel(card: HTMLElement, summary: ProgressSummary): void {
  const label = card.querySelector<HTMLElement>(PROGRESS_LABEL_SELECTOR);
  if (label) {
    label.textContent = labelFor(summary);
  }
}

function setCompletionVisibility(
  card: HTMLElement,
  summary: ProgressSummary,
): void {
  const done = card.querySelector<HTMLElement>(PROGRESS_DONE_SELECTOR);
  if (done) {
    done.style.display = summary.completed ? "" : "none";
  }
}

function applyToCard(id: string, summary: ProgressSummary): void {
  const card = document.querySelector<HTMLElement>(ARTICLE_CARD_SELECTOR(id));
  if (!card) {
    return;
  }

  setProgressBar(card, summary);
  setProgressLabel(card, summary);
  setCompletionVisibility(card, summary);
}

function applyProgress(progress: Record<string, ProgressSummary>, ids: string[]) {
  for (const id of ids) {
    const summary = progress[id];
    if (summary) {
      applyToCard(id, summary);
    }
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
    const toRefresh = getIdsToRefresh(articleIds);
    if (toRefresh.length === 0) {
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        // batch DOM sync: not a user mutation, uses raw fetch for non-interactive state sync
        const res = await fetch(BATCH_PROGRESS_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: toRefresh }),
        });
        if (!res.ok || cancelled) {
          return;
        }
        const data = (await res.json()) as BatchResponse;
        const progress = data.progress ?? {};
        applyProgress(progress, toRefresh);
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
