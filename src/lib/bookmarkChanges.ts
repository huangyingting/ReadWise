/**
 * Client-side tracking of articles whose bookmark state changed during this
 * session. Listings use this to refresh the saved indicator for ONLY the
 * articles the user actually bookmarked/unbookmarked (rather than re-fetching
 * the whole listing on every navigation). Backed by sessionStorage so it is
 * scoped to the current browser tab/session.
 *
 * Parallel to src/lib/visited.ts (reading-progress tracking).
 */
import { STORAGE_KEYS } from "./storage-keys";

const STORAGE_KEY = STORAGE_KEYS.BOOKMARK_CHANGES;

function isBrowserSession(): boolean {
  return typeof window !== "undefined";
}

function stringIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((id): id is string => typeof id === "string");
}

function read(): string[] {
  if (!isBrowserSession()) {
    return [];
  }
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    return raw ? stringIds(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

function write(ids: string[]): void {
  if (!isBrowserSession()) {
    return;
  }
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    /* storage may be unavailable (private mode / quota) — ignore */
  }
}

/** Record that an article's bookmark state changed so listings can refresh it. */
export function markBookmarkChanged(id: string): void {
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

/** All article ids whose bookmark state changed this session. */
export function getBookmarkChangedIds(): string[] {
  return read();
}

/** Drop the given ids from the changed set (after their state is merged). */
export function clearBookmarkChangedIds(ids: string[]): void {
  if (ids.length === 0) {
    return;
  }
  const remove = new Set(ids);
  const remaining = read().filter((id) => !remove.has(id));
  write(remaining);
}
