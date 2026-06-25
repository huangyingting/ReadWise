/**
 * highlightsReducer — reader highlights state store (REF-030).
 *
 * Pure reducer extracted from ReaderHighlightsProvider.  Handles optimistic
 * CRUD mutations — add, replace optimistic with real, revert optimistic on
 * failure, update a field patch, and remove — plus the initial load.
 *
 * No React or browser dependencies: fully unit-testable in Node.
 */

import type { Highlight } from "@/components/ReaderHighlightsProvider";

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export type HighlightAction =
  | { type: "SET"; highlights: Highlight[] }
  | { type: "ADD_OPTIMISTIC"; optimistic: Highlight }
  | { type: "REPLACE_OPTIMISTIC"; tempId: string; real: Highlight }
  | { type: "REVERT_OPTIMISTIC"; tempId: string }
  | { type: "UPDATE"; id: string; patch: Partial<Highlight> }
  | { type: "REMOVE"; id: string };

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

function sortByOffset(highlights: Highlight[]): Highlight[] {
  return [...highlights].sort((a, b) => a.startOffset - b.startOffset);
}

export function highlightsReducer(
  state: Highlight[],
  action: HighlightAction,
): Highlight[] {
  switch (action.type) {
    case "SET":
      return action.highlights;
    case "ADD_OPTIMISTIC":
      return sortByOffset([...state, action.optimistic]);
    case "REPLACE_OPTIMISTIC":
      return sortByOffset(
        state.map((h) => (h.id === action.tempId ? action.real : h)),
      );
    case "REVERT_OPTIMISTIC":
      return state.filter((h) => h.id !== action.tempId);
    case "UPDATE":
      return state.map((h) =>
        h.id === action.id ? { ...h, ...action.patch } : h,
      );
    case "REMOVE":
      return state.filter((h) => h.id !== action.id);
    default:
      return state;
  }
}
