"use client";

import * as React from "react";
import { useFloatingPosition } from "@/components/ui";
import { useFocusTrap } from "@/lib/focus-trap";

type ReaderFloatingRect = Pick<DOMRect, "top" | "right" | "bottom" | "left">;
type ReaderFloatingPoint = { x: number; y: number };

export type ReaderFloatingAnchor = ReaderFloatingRect | ReaderFloatingPoint;

export type ReaderFloatingSurfaceProps = {
  anchor: ReaderFloatingAnchor;
  placement: "above" | "below";
  role?: "dialog" | "toolbar";
  label: string;
  onClose: () => void;
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  className: string;
  gap?: number;
  busy?: boolean;
  children: React.ReactNode;
};

const MINI_PLAYER_SAFE_AREA_PX = 56;

function isPointAnchor(
  anchor: ReaderFloatingAnchor,
): anchor is ReaderFloatingPoint {
  return "x" in anchor;
}

export const ReaderFloatingSurface = React.forwardRef<
  HTMLDivElement,
  ReaderFloatingSurfaceProps
>(function ReaderFloatingSurface(
  {
    anchor,
    placement,
    role = "dialog",
    label,
    onClose,
    initialFocusRef,
    className,
    gap,
    busy,
    children,
  },
  forwardedRef,
) {
  const surfaceRef = React.useRef<HTMLDivElement>(null);
  React.useImperativeHandle(forwardedRef, () => surfaceRef.current!, []);

  useFloatingPosition(surfaceRef, anchor, {
    placement,
    align: isPointAnchor(anchor) || placement === "above" ? "center" : "start",
    gap,
    safeArea: { bottom: MINI_PLAYER_SAFE_AREA_PX },
    constrainSize: true,
  });
  useFocusTrap(surfaceRef, true, onClose, {
    initialFocusRef,
    stopEscapePropagation: true,
  });

  return (
    <div
      ref={surfaceRef}
      role={role}
      aria-label={label}
      aria-modal={role === "dialog" ? false : undefined}
      aria-busy={busy || undefined}
      tabIndex={-1}
      className={className}
      onMouseUp={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {children}
    </div>
  );
});