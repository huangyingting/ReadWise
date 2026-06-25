/**
 * M11 — Highlights & Notes
 *
 * @deprecated Import directly from `@/lib/annotations`.
 * This module is a thin re-export shim kept for backward compatibility.
 * All implementation has moved to the annotation domain service.
 */
export {
  HIGHLIGHT_NOTE_MAX,
  HIGHLIGHT_COLORS,
  validateAnchor,
  annotateHighlightAnchors,
  listHighlights,
  listAllUserHighlights,
  getHighlightCounts,
  createHighlight,
  updateHighlight,
  deleteHighlight,
} from "@/lib/annotations";
export type {
  HighlightColor,
  CreateHighlightInput,
  UpdateHighlightInput,
  HighlightRow,
  HighlightWithAnchor,
  HighlightWithArticle,
} from "@/lib/annotations";
