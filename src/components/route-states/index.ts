/**
 * Shared route-segment state components (REF-063).
 *
 * Re-exports the building blocks that individual `error.tsx`, `not-found.tsx`,
 * and `loading.tsx` files use to avoid duplication while satisfying Next.js's
 * file-based segment-state requirements.
 */

export { SegmentError } from "./SegmentError";
export type { SegmentErrorProps } from "./SegmentError";

export { SegmentNotFound } from "./SegmentNotFound";
export type { SegmentNotFoundProps } from "./SegmentNotFound";

export { ListingLoadingShell } from "./ListingLoadingShell";
export type { ListingLoadingShellProps } from "./ListingLoadingShell";
