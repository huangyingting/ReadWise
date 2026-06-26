/**
 * Annotation domain service (REF-050).
 *
 * Public API for the annotation subsystem: highlights, anchors, notes, and
 * offline conflict resolution. Routes and other consumers should import from
 * this barrel rather than the individual implementation modules.
 *
 * Module layout:
 *   anchor.ts   — pure anchor types, constants, validation, and enrichment
 *   queries.ts  — server read models (list, listAll, counts)
 *   commands.ts — server mutations (create, update, delete) with conflict logic
 *
 * Offline-conflict primitives from @/lib/offline-conflict are re-exported here
 * so the annotation subsystem is a self-contained dependency for callers that
 * need both the commands/queries and the conflict resolution rules.
 */

// Anchor types, constants, validation, annotation
export {
  HIGHLIGHT_NOTE_MAX,
  HIGHLIGHT_COLORS,
  validateAnchor,
  annotateHighlightAnchors,
} from "./anchor";
export type {
  HighlightColor,
  CreateHighlightInput,
  UpdateHighlightInput,
  HighlightRow,
  HighlightWithAnchor,
  HighlightWithArticle,
} from "./anchor";

// Server read models
export {
  listHighlights,
  listAllUserHighlights,
  listAllUserHighlightsPage,
  getHighlightCounts,
  HIGHLIGHTS_ALL_HARD_CAP,
} from "./queries";
export type { HighlightPage } from "./queries";

// Server mutation commands
export { createHighlight, updateHighlight, deleteHighlight } from "./commands";

// Conflict resolution helpers (re-exported for the offline sync layer)
export {
  resolveProgress,
  resolveLastWriteWins,
  revalidateAnchor,
  mergeNoteConflict,
  NOTE_CONFLICT_SEPARATOR,
} from "@/lib/offline-conflict";
export type {
  AnchorStatus,
  AnchorRevalidation,
  HighlightAnchor,
  NoteMergeResult,
} from "@/lib/offline-conflict";
