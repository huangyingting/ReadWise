"use client";

/**
 * useAutoGrowingTextarea
 *
 * Auto-grow behavior for the tutor composer textarea.
 *
 * - Expands to fit content up to MAX_HEIGHT_PX.
 * - `resetHeight()` collapses back to the single-row default after sending.
 */

import { useCallback, useRef } from "react";
import type { RefObject } from "react";

const MAX_HEIGHT_PX = 140;

export interface AutoGrowingTextareaResult {
  composerRef: RefObject<HTMLTextAreaElement | null>;
  handleInputChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  resetHeight: () => void;
}

/**
 * @param onValueChange — called with the new textarea value on each change.
 *                        Pass `setQuestion` from the parent component.
 */
export function useAutoGrowingTextarea(
  onValueChange: (value: string) => void,
): AutoGrowingTextareaResult {
  const composerRef = useRef<HTMLTextAreaElement | null>(null);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      onValueChange(e.target.value);
      // Auto-grow: reset to auto then set to scrollHeight (clamped via MAX_HEIGHT_PX)
      const ta = e.target;
      ta.style.height = "auto";
      ta.style.height = `${Math.min(ta.scrollHeight, MAX_HEIGHT_PX)}px`;
    },
    [onValueChange],
  );

  const resetHeight = useCallback(() => {
    if (composerRef.current) {
      composerRef.current.style.height = "auto";
    }
  }, []);

  return { composerRef, handleInputChange, resetHeight };
}
