"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import { ChevronRight, ChevronLeft } from "lucide-react";
import { IconButton } from "@/components/ui";
import { cn } from "@/lib/cn";

interface RailScrollerProps {
  children: React.ReactNode;
}

const SCROLL_EDGE_THRESHOLD = 4;
const DEFAULT_CARD_WIDTH = 260;
const CARD_GAP_PX = 16;
const RAIL_BUTTON_CLASS = cn(
  "absolute top-1/2 -translate-y-1/2 z-10",
  "h-9 w-9 inline-flex items-center justify-center shrink-0",
  "rounded-full bg-surface border border-border shadow-[var(--shadow-md)]",
  "text-text-muted hover:text-text hover:bg-bg-subtle",
  "transition-[opacity,transform] [transition-duration:var(--duration-fast)]",
);

function canScrollBack(el: HTMLElement): boolean {
  return el.scrollLeft > SCROLL_EDGE_THRESHOLD;
}

function canScrollForward(el: HTMLElement): boolean {
  return (
    el.scrollLeft + el.clientWidth <
    el.scrollWidth - SCROLL_EDGE_THRESHOLD
  );
}

function firstCardWidth(el: HTMLElement): number {
  return (
    el.querySelector<HTMLElement>(":scope > *")?.offsetWidth ??
    DEFAULT_CARD_WIDTH
  );
}

/**
 * Horizontal scroll rail with prev/next chevron buttons for pointer users.
 * Touch/trackpad users scroll naturally; buttons appear/disappear based on
 * scroll position.
 */
export default function RailScroller({ children }: RailScrollerProps) {
  const railRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateArrows = useCallback(() => {
    const el = railRef.current;
    if (!el) return;
    setCanScrollLeft(canScrollBack(el));
    setCanScrollRight(canScrollForward(el));
  }, []);

  useEffect(() => {
    const el = railRef.current;
    if (!el) return;
    updateArrows();
    el.addEventListener("scroll", updateArrows, { passive: true });
    const ro = new ResizeObserver(updateArrows);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", updateArrows);
      ro.disconnect();
    };
  }, [updateArrows]);

  function scrollBy(dir: 1 | -1) {
    const el = railRef.current;
    if (!el) return;
    const cardWidth = firstCardWidth(el);
    el.scrollBy({ left: dir * (cardWidth + CARD_GAP_PX), behavior: "smooth" });
  }

  return (
    <div className="relative">
      {canScrollLeft && (
        <IconButton
          aria-label="Scroll left"
          onClick={() => scrollBy(-1)}
          className={cn(RAIL_BUTTON_CLASS, "left-0 -translate-x-1/2")}
        >
          <ChevronLeft size={18} aria-hidden />
        </IconButton>
      )}

      <div
        ref={railRef}
        tabIndex={0}
        className="flex gap-[var(--space-4)] overflow-x-auto pb-[var(--space-3)] -mx-[var(--space-1)] px-[var(--space-1)] snap-x snap-mandatory rw-rail-mask"
        style={{
          scrollbarWidth: "thin",
          scrollbarColor: "var(--border) transparent",
        }}
      >
        {children}
      </div>

      {canScrollRight && (
        <IconButton
          aria-label="Scroll right"
          onClick={() => scrollBy(1)}
          className={cn(RAIL_BUTTON_CLASS, "right-0 translate-x-1/2")}
        >
          <ChevronRight size={18} aria-hidden />
        </IconButton>
      )}
    </div>
  );
}
