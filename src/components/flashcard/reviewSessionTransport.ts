import type { DueCard, ReviewMode } from "./types";
import type { Grade } from "@/lib/learning/srs";

export interface LoadedReviewCards {
  cards: DueCard[];
  dueCount: number;
}

export interface GradedReviewCard {
  dueAt: string | null;
  dueCount: number;
}

function reviewEndpointForMode(mode: ReviewMode): string {
  return mode === "cloze" ? "/api/study/cloze" : "/api/study/flashcards";
}

export async function fetchReviewCards(
  mode: ReviewMode,
  signal?: AbortSignal,
): Promise<LoadedReviewCards> {
  const res = await fetch(reviewEndpointForMode(mode), { signal });
  if (!res.ok) throw new Error("fetch failed");

  if (mode === "cloze") {
    const data = (await res.json()) as { items: DueCard[] };
    return { cards: data.items, dueCount: data.items.length };
  }

  const data = (await res.json()) as {
    cards: DueCard[];
    dueCount: number;
  };
  return { cards: data.cards, dueCount: data.dueCount };
}

export async function submitReviewGrade(
  savedWordId: string,
  grade: Grade,
  signal?: AbortSignal,
): Promise<GradedReviewCard | null> {
  const res = await fetch("/api/study/flashcards/grade", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ savedWordId, grade }),
    signal,
  });

  if (!res.ok) return null;
  return (await res.json()) as GradedReviewCard;
}

export function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}
