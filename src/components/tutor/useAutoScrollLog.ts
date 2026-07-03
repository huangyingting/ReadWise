"use client";

/**
 * useAutoScrollLog
 *
 * Manages scroll-to-bottom behavior for a chat message list (role="log").
 *
 * - When asking starts: scrolls instantly so user sees their question.
 * - When asking ends: smart-scrolls if already at bottom; otherwise shows
 *   a jump pill so the user can scroll manually.
 * - Respects prefers-reduced-motion for smooth-scroll calls.
 */

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";

const BOTTOM_THRESHOLD_PX = 48;
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function isAtBottom(el: HTMLElement): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_THRESHOLD_PX;
}

function scrollToBottomInstant(el: HTMLElement): void {
  el.scrollTop = el.scrollHeight;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia(REDUCED_MOTION_QUERY).matches
  );
}

function scrollToBottomSmooth(el: HTMLElement): void {
  if (prefersReducedMotion()) {
    el.scrollTop = el.scrollHeight;
  } else {
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }
}

export interface AutoScrollLogResult {
  listRef: RefObject<HTMLDivElement | null>;
  jumpVisible: boolean;
  setJumpVisible: React.Dispatch<React.SetStateAction<boolean>>;
  scrollToBottom: () => void;
}

interface AutoScrollLogOptions {
  asking: boolean;
}

export function useAutoScrollLog({
  asking,
}: AutoScrollLogOptions): AutoScrollLogResult {
  const listRef = useRef<HTMLDivElement | null>(null);
  const [jumpVisible, setJumpVisible] = useState(false);
  const prevAskingRef = useRef(false);

  // Fires after DOM commits so scroll measurements are accurate.
  useLayoutEffect(() => {
    const wasAsking = prevAskingRef.current;
    prevAskingRef.current = asking;

    const list = listRef.current;
    if (!list) return;

    if (!wasAsking && asking) {
      // Just started asking → scroll to bottom instantly so user sees question.
      scrollToBottomInstant(list);
      setJumpVisible(false);
      return;
    }

    if (wasAsking && !asking) {
      // Answer arrived → smart scroll.
      if (isAtBottom(list)) {
        scrollToBottomSmooth(list);
        setJumpVisible(false);
      } else {
        setJumpVisible(true);
      }
    }
  }, [asking]);

  const scrollToBottom = useCallback(() => {
    const list = listRef.current;
    if (!list) return;
    scrollToBottomSmooth(list);
    setJumpVisible(false);
  }, []);

  return { listRef, jumpVisible, setJumpVisible, scrollToBottom };
}
