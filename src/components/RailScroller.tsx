"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import { ChevronRight, ChevronLeft } from "lucide-react";
import { cn, focusRing } from "@/lib/cn";

interface RailScrollerProps {
  children: React.ReactNode;
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
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
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
    const cardWidth = el.querySelector<HTMLElement>(":scope > *")?.offsetWidth ?? 260;
    el.scrollBy({ left: dir * (cardWidth + 16), behavior: "smooth" });
  }

  const chevronClass = cn(
    "absolute top-1/2 -translate-y-1/2 z-10",
    "h-9 w-9 inline-flex items-center justify-center shrink-0",
    "rounded-full bg-surface border border-border shadow-[var(--shadow-md)]",
    "text-text-muted hover:text-text hover:bg-bg-subtle",
    "transition-[opacity,transform] [transition-duration:var(--duration-fast)]",
    focusRing,
  );

  return (
    <div className="relative">
      {canScrollLeft && (
        <button
          type="button"
          aria-label="Scroll left"
          onClick={() => scrollBy(-1)}
          className={cn(chevronClass, "left-0 -translate-x-1/2")}
        >
          <ChevronLeft size={18} aria-hidden />
        </button>
      )}

      <div
        ref={railRef}
        tabIndex={0}
        className="flex gap-[var(--space-4)] overflow-x-auto pb-[var(--space-3)] -mx-[var(--space-1)] px-[var(--space-1)] snap-x snap-mandatory rw-rail-mask"
        style={{ scrollbarWidth: "thin", scrollbarColor: "var(--border) transparent" }}
      >
        {children}
      </div>

      {canScrollRight && (
        <button
          type="button"
          aria-label="Scroll right"
          onClick={() => scrollBy(1)}
          className={cn(chevronClass, "right-0 translate-x-1/2")}
        >
          <ChevronRight size={18} aria-hidden />
        </button>
      )}
    </div>
  );
}
