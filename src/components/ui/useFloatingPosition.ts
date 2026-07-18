"use client";

import { useLayoutEffect, useRef, type RefObject } from "react";
import {
  computeFloatingLayout,
  type FloatingAlign,
  type FloatingPlacement,
  type FloatingViewport,
} from "./floating-layout";

type FloatingRect = Pick<DOMRect, "top" | "right" | "bottom" | "left">;
type FloatingPoint = { x: number; y: number };

export type FloatingAnchor =
  | FloatingRect
  | FloatingPoint
  | RefObject<HTMLElement | null>;

export type FloatingCssLength = {
  cssVariable: `--${string}`;
  fallback?: number;
};

type FloatingPositionLength = number | FloatingCssLength;

export type FloatingPositionSafeArea = {
  top?: FloatingPositionLength;
  right?: FloatingPositionLength;
  bottom?: FloatingPositionLength;
  left?: FloatingPositionLength;
};

export type FloatingPositionOptions = {
  active?: boolean;
  placement: FloatingPlacement;
  align?: FloatingAlign;
  gap?: number;
  viewportPadding?: number;
  safeArea?: FloatingPositionSafeArea;
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

export function resolveCssLengthPx(
  scope: HTMLElement,
  variable: `--${string}`,
  fallbackPx = 0,
): number {
  const view = scope.ownerDocument.defaultView;
  if (!view) return fallbackPx;

  const cssValue = view.getComputedStyle(scope)
    .getPropertyValue(variable)
    .trim();
  if (!cssValue) return fallbackPx;

  const absoluteLength = cssValue.match(
    /^(-?(?:\d+(?:\.\d+)?|\.\d+))(px|rem)$/,
  );
  if (absoluteLength) {
    const numeric = Number.parseFloat(absoluteLength[1]);
    if (absoluteLength[2] === "px") return numeric;

    const rootFontPx = Number.parseFloat(
      view.getComputedStyle(scope.ownerDocument.documentElement).fontSize,
    );
    return Number.isFinite(rootFontPx) ? numeric * rootFontPx : fallbackPx;
  }

  const probe = scope.ownerDocument.createElement("div");
  probe.style.position = "fixed";
  probe.style.visibility = "hidden";
  probe.style.pointerEvents = "none";
  probe.style.contain = "strict";
  probe.style.width = "0";
  probe.style.height = `var(${variable})`;
  scope.appendChild(probe);
  try {
    const resolved = Number.parseFloat(view.getComputedStyle(probe).height);
    return Number.isFinite(resolved) ? resolved : fallbackPx;
  } finally {
    probe.remove();
  }
}

function resolveFloatingLengthPx(
  scope: HTMLElement,
  length: FloatingPositionLength | undefined,
): number {
  if (length === undefined) return 0;
  if (typeof length === "number") return length;
  return resolveCssLengthPx(scope, length.cssVariable, length.fallback);
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
        gap:
          gap ?? resolveCssLengthPx(nextFloating, "--space-2", GAP_FALLBACK_PX),
        viewportPadding:
          viewportPadding ??
          resolveCssLengthPx(
            nextFloating,
            "--space-3",
            VIEWPORT_PADDING_FALLBACK_PX,
          ),
        safeArea: {
          top: resolveFloatingLengthPx(nextFloating, safeTop),
          right: resolveFloatingLengthPx(nextFloating, safeRight),
          bottom: resolveFloatingLengthPx(nextFloating, safeBottom),
          left: resolveFloatingLengthPx(nextFloating, safeLeft),
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