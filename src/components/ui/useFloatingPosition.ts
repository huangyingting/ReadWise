"use client";

import { useLayoutEffect, useRef, type RefObject } from "react";
import {
  computeFloatingLayout,
  type FloatingAlign,
  type FloatingPlacement,
  type FloatingSafeArea,
  type FloatingViewport,
} from "./floating-layout";

type FloatingRect = Pick<DOMRect, "top" | "right" | "bottom" | "left">;
type FloatingPoint = { x: number; y: number };

export type FloatingAnchor =
  | FloatingRect
  | FloatingPoint
  | RefObject<HTMLElement | null>;

export type FloatingPositionOptions = {
  active?: boolean;
  placement: FloatingPlacement;
  align?: FloatingAlign;
  gap?: number;
  viewportPadding?: number;
  safeArea?: FloatingSafeArea;
  flip?: boolean;
  constrainSize?: boolean;
  matchAnchorWidth?: boolean;
};

const GAP_FALLBACK_PX = 8;
const VIEWPORT_PADDING_FALLBACK_PX = 12;

function isPointAnchor(anchor: FloatingAnchor): anchor is FloatingPoint {
  return "x" in anchor && "y" in anchor;
}

function isRefAnchor(
  anchor: FloatingAnchor,
): anchor is RefObject<HTMLElement | null> {
  return "current" in anchor;
}

function anchorRect(anchor: FloatingAnchor): FloatingRect | null {
  if (isRefAnchor(anchor)) return anchor.current?.getBoundingClientRect() ?? null;
  if (isPointAnchor(anchor)) {
    return { top: anchor.y, right: anchor.x, bottom: anchor.y, left: anchor.x };
  }
  return anchor;
}

function anchorElement(anchor: FloatingAnchor): HTMLElement | null {
  return isRefAnchor(anchor) ? anchor.current : null;
}

function readCssLengthPx(variable: string, fallbackPx: number): number {
  const cssValue = getComputedStyle(document.documentElement)
    .getPropertyValue(variable)
    .trim();
  if (!cssValue) return fallbackPx;

  const numeric = Number.parseFloat(cssValue);
  if (!Number.isFinite(numeric)) return fallbackPx;
  if (!cssValue.endsWith("rem")) return numeric;

  const rootFontPx = Number.parseFloat(
    getComputedStyle(document.documentElement).fontSize,
  );
  return Number.isFinite(rootFontPx) ? numeric * rootFontPx : fallbackPx;
}

function readComputedPixelLimit(value: string): number | undefined {
  if (!value.endsWith("px")) return undefined;
  const numeric = Number.parseFloat(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function currentViewport(): FloatingViewport {
  const visualViewport = window.visualViewport;
  if (visualViewport) {
    return {
      left: visualViewport.offsetLeft,
      top: visualViewport.offsetTop,
      width: visualViewport.width,
      height: visualViewport.height,
    };
  }

  return { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
}

export function useFloatingPosition(
  floatingRef: RefObject<HTMLElement | null>,
  anchor: FloatingAnchor,
  options: FloatingPositionOptions,
): void {
  const {
    active = true,
    placement,
    align = "start",
    gap,
    viewportPadding,
    safeArea,
    flip = true,
    constrainSize = false,
    matchAnchorWidth = false,
  } = options;
  const safeTop = safeArea?.top ?? 0;
  const safeRight = safeArea?.right ?? 0;
  const safeBottom = safeArea?.bottom ?? 0;
  const safeLeft = safeArea?.left ?? 0;
  const animationFrameRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    if (!active) return;
    const floating = floatingRef.current;
    if (!floating || !anchorRect(anchor)) return;

    function applyLayout() {
      const nextFloating = floatingRef.current;
      const nextAnchorRect = anchorRect(anchor);
      if (!nextFloating || !nextAnchorRect) return;

      let sizeLimit: { width?: number; height?: number } | undefined;
      if (constrainSize) {
        nextFloating.style.maxHeight = "";
        nextFloating.style.maxWidth = "";
        const computedStyle = getComputedStyle(nextFloating);
        sizeLimit = {
          width: readComputedPixelLimit(computedStyle.maxWidth),
          height: readComputedPixelLimit(computedStyle.maxHeight),
        };
      }

      if (matchAnchorWidth) {
        nextFloating.style.width = `${nextAnchorRect.right - nextAnchorRect.left}px`;
      } else {
        nextFloating.style.width = "";
      }

      const layout = computeFloatingLayout({
        anchorRect: nextAnchorRect,
        floatingWidth: Math.max(nextFloating.offsetWidth, nextFloating.scrollWidth),
        floatingHeight: Math.max(nextFloating.offsetHeight, nextFloating.scrollHeight),
        viewport: currentViewport(),
        preferredPlacement: placement,
        align,
        gap: gap ?? readCssLengthPx("--space-2", GAP_FALLBACK_PX),
        viewportPadding:
          viewportPadding ??
          readCssLengthPx("--space-3", VIEWPORT_PADDING_FALLBACK_PX),
        safeArea: {
          top: safeTop,
          right: safeRight,
          bottom: safeBottom,
          left: safeLeft,
        },
        sizeLimit,
        flip,
      });

      nextFloating.style.left = `${layout.left}px`;
      nextFloating.style.top = `${layout.top}px`;
      nextFloating.dataset.floatingPlacement = layout.placement;
      if (constrainSize) {
        nextFloating.style.maxHeight = `${layout.maxHeight}px`;
        nextFloating.style.maxWidth = `${layout.maxWidth}px`;
      }
    }

    function scheduleLayout() {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      animationFrameRef.current = requestAnimationFrame(() => {
        animationFrameRef.current = null;
        applyLayout();
      });
    }

    const resizeObserver = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(scheduleLayout);
    resizeObserver?.observe(floating);
    const observedAnchor = anchorElement(anchor);
    if (observedAnchor) resizeObserver?.observe(observedAnchor);

    const visualViewport = window.visualViewport;
    window.addEventListener("resize", scheduleLayout);
    window.addEventListener("orientationchange", scheduleLayout);
    window.addEventListener("scroll", scheduleLayout, true);
    visualViewport?.addEventListener("resize", scheduleLayout);
    visualViewport?.addEventListener("scroll", scheduleLayout);
    scheduleLayout();

    return () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      resizeObserver?.disconnect();
      window.removeEventListener("resize", scheduleLayout);
      window.removeEventListener("orientationchange", scheduleLayout);
      window.removeEventListener("scroll", scheduleLayout, true);
      visualViewport?.removeEventListener("resize", scheduleLayout);
      visualViewport?.removeEventListener("scroll", scheduleLayout);
    };
  }, [
    active,
    floatingRef,
    anchor,
    placement,
    align,
    gap,
    viewportPadding,
    safeTop,
    safeRight,
    safeBottom,
    safeLeft,
    flip,
    constrainSize,
    matchAnchorWidth,
  ]);
}