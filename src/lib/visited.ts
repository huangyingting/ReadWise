/**
 * Client-side tracking of recently visited articles. Listings use this to
 * refresh progress for ONLY the articles the reader actually opened (rather
 * than re-fetching the whole listing on every navigation). Backed by
 * sessionStorage so it is scoped to the current browser tab/session.
 */
import { STORAGE_KEYS } from "./storage-keys";

const STORAGE_KEY = STORAGE_KEYS.VISITED_ARTICLES;

function read(): string[] {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((id): id is string => typeof id === "string");
  } catch {
    return [];
  }
}

function write(ids: string[]): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    /* storage may be unavailable (private mode / quota) — ignore */
  }
}

/** Record that the reader opened an article so listings can refresh it later. */
export function markArticleVisited(id: string): void {
  if (!id) {
    return;
  }
  const ids = read();
  if (ids.includes(id)) {
    return;
  }
  ids.push(id);
  write(ids);
}

/** All article ids visited this session. */
export function getVisitedArticleIds(): string[] {
  return read();
}

/** Drop the given ids from the visited set (after their progress is merged). */
export function clearVisitedArticleIds(ids: string[]): void {
  if (ids.length === 0) {
    return;
  }
  const remove = new Set(ids);
  const remaining = read().filter((id) => !remove.has(id));
  write(remaining);
}
