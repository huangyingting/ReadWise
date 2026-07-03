"use client";

import { useCallback } from "react";
import type { RefObject } from "react";
import type {
  Highlight as RwHighlight,
  CreateHighlightInput,
  HighlightColor,
} from "@/components/ReaderHighlightsProvider";
import { overlapsAny } from "./highlightMarks";
import type { SavedAnchor } from "./selectionHelpers";

const CONTEXT_WINDOW_CHARS = 32;
const MARK_PAINT_DELAY_MS = 80;

type HighlightRange = {
  startOffset: number;
  endOffset: number;
};

function getMergedRange(
  savedAnchor: SavedAnchor,
  overlapping: RwHighlight[],
): HighlightRange {
  return {
    startOffset: Math.min(
      savedAnchor.startOffset,
      ...overlapping.map((h) => h.startOffset),
    ),
    endOffset: Math.max(
      savedAnchor.endOffset,
      ...overlapping.map((h) => h.endOffset),
    ),
  };
}

function getFirstMergedNote(overlapping: RwHighlight[]) {
  return (
    overlapping
      .filter((h) => h.note)
      .sort((a, b) => a.startOffset - b.startOffset)[0]?.note ?? null
  );
}

function buildSavedHighlightInput(
  savedAnchor: SavedAnchor,
  color: HighlightColor,
): CreateHighlightInput {
  const { quote, startOffset, endOffset, prefix, suffix } = savedAnchor;
  return { quote, startOffset, endOffset, prefix, suffix, color };
}

function buildMergedHighlightInput({
  fullText,
  range,
  color,
  note,
}: {
  fullText: string;
  range: HighlightRange;
  color: HighlightColor;
  note?: string | null;
}): CreateHighlightInput {
  const { startOffset, endOffset } = range;

  return {
    quote: fullText.slice(startOffset, endOffset),
    startOffset,
    endOffset,
    prefix: fullText.slice(
      Math.max(0, startOffset - CONTEXT_WINDOW_CHARS),
      startOffset,
    ),
    suffix: fullText.slice(
      endOffset,
      Math.min(fullText.length, endOffset + CONTEXT_WINDOW_CHARS),
    ),
    color,
    note: note ?? undefined,
  };
}

async function removeHighlights(
  highlights: RwHighlight[],
  remove: (id: string) => Promise<void>,
) {
  for (const h of highlights) await remove(h.id);
}

/**
 * Provides the two highlight-creation actions used by the selection toolbar:
 * plain highlight and highlight-with-note. Both implement the same overlap-merge
 * strategy: when new selection overlaps an existing highlight, all overlapping
 * highlights are replaced with a single merged highlight spanning the full
 * combined range, preserving the first note found among the merged highlights.
 */
export function useHighlightActions(
  highlights: RwHighlight[],
  add: (input: CreateHighlightInput) => Promise<RwHighlight | null>,
  remove: (id: string) => Promise<void>,
  proseRef: RefObject<HTMLElement | null>,
) {
  /**
   * Creates a plain highlight for the saved selection. Merges any overlapping
   * highlights into a single range before saving.
   */
  const handleHighlight = useCallback(
    async (savedAnchor: SavedAnchor, color: HighlightColor): Promise<void> => {
      const prose = proseRef.current;
      if (!prose) return;
      const { startOffset, endOffset } = savedAnchor;
      const overlapping = overlapsAny(startOffset, endOffset, highlights);
      if (overlapping.length > 0) {
        const fullText = prose.textContent ?? "";
        const range = getMergedRange(savedAnchor, overlapping);
        const mergedNote = getFirstMergedNote(overlapping);

        await removeHighlights(overlapping, remove);
        await add(
          buildMergedHighlightInput({
            fullText,
            range,
            color,
            note: mergedNote,
          }),
        );
      } else {
        await add(buildSavedHighlightInput(savedAnchor, color));
      }
    },
    [highlights, add, remove, proseRef],
  );

  /**
   * Creates a highlight for the saved selection and then opens the note editor.
   * The `onReadyForEdit` callback is invoked inside a 80 ms timeout that waits
   * for `applyHighlightMarks` to paint the new `<mark>` into the DOM before
   * querying it.
   */
  const handleAddNote = useCallback(
    async (
      savedAnchor: SavedAnchor,
      color: HighlightColor,
      onReadyForEdit: (hlId: string, markEl: HTMLElement) => void,
    ): Promise<void> => {
      const prose = proseRef.current;
      const { startOffset, endOffset } = savedAnchor;
      const overlapping = overlapsAny(startOffset, endOffset, highlights);
      let newHl: RwHighlight | null = null;

      if (overlapping.length > 0) {
        const fullText = prose?.textContent ?? "";
        const range = getMergedRange(savedAnchor, overlapping);

        await removeHighlights(overlapping, remove);
        newHl = await add(
          buildMergedHighlightInput({
            fullText,
            range,
            color,
          }),
        );
      } else {
        newHl = await add(buildSavedHighlightInput(savedAnchor, color));
      }

      if (newHl) {
        const hlId = newHl.id;
        setTimeout(() => {
          const markEl = document.querySelector<HTMLElement>(
            `mark.rw-hl[data-hl-id="${hlId}"]`,
          );
          if (markEl) onReadyForEdit(hlId, markEl);
        }, MARK_PAINT_DELAY_MS);
      }
    },
    [highlights, add, remove, proseRef],
  );

  return { handleHighlight, handleAddNote };
}
