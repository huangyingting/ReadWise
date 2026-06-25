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
      const { quote, startOffset, endOffset, prefix, suffix } = savedAnchor;
      const overlapping = overlapsAny(startOffset, endOffset, highlights);
      if (overlapping.length > 0) {
        const fullText = prose.textContent ?? "";
        const ns = Math.min(startOffset, ...overlapping.map((h) => h.startOffset));
        const ne = Math.max(endOffset, ...overlapping.map((h) => h.endOffset));
        const mergedNote =
          overlapping
            .filter((h) => h.note)
            .sort((a, b) => a.startOffset - b.startOffset)[0]?.note ?? null;
        for (const h of overlapping) await remove(h.id);
        await add({
          quote: fullText.slice(ns, ne),
          startOffset: ns,
          endOffset: ne,
          prefix: fullText.slice(Math.max(0, ns - 32), ns),
          suffix: fullText.slice(ne, Math.min(fullText.length, ne + 32)),
          color,
          note: mergedNote ?? undefined,
        });
      } else {
        await add({ quote, startOffset, endOffset, prefix, suffix, color });
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
      const { quote, startOffset, endOffset, prefix, suffix } = savedAnchor;
      const overlapping = overlapsAny(startOffset, endOffset, highlights);
      let newHl: RwHighlight | null = null;

      if (overlapping.length > 0) {
        const fullText = prose?.textContent ?? "";
        const ns = Math.min(startOffset, ...overlapping.map((h) => h.startOffset));
        const ne = Math.max(endOffset, ...overlapping.map((h) => h.endOffset));
        for (const h of overlapping) await remove(h.id);
        newHl = await add({
          quote: fullText.slice(ns, ne),
          startOffset: ns,
          endOffset: ne,
          prefix: fullText.slice(Math.max(0, ns - 32), ns),
          suffix: fullText.slice(ne, Math.min(fullText.length, ne + 32)),
          color,
        });
      } else {
        newHl = await add({ quote, startOffset, endOffset, prefix, suffix, color });
      }

      if (newHl) {
        const hlId = newHl.id;
        setTimeout(() => {
          const markEl = document.querySelector<HTMLElement>(
            `mark.rw-hl[data-hl-id="${hlId}"]`,
          );
          if (markEl) onReadyForEdit(hlId, markEl);
        }, 80);
      }
    },
    [highlights, add, remove, proseRef],
  );

  return { handleHighlight, handleAddNote };
}
