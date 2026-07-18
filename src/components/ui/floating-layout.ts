export type FloatingAlign = "start" | "center" | "end";
export type FloatingPlacement = "above" | "below" | "left" | "right";

export type FloatingViewport = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type FloatingSafeArea = {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
};

export type FloatingSizeLimit = {
  width?: number;
  height?: number;
};

export type FloatingLayoutInput = {
  anchorRect: Pick<DOMRect, "top" | "right" | "bottom" | "left">;
  floatingWidth: number;
  floatingHeight: number;
  viewport: FloatingViewport;
  preferredPlacement: FloatingPlacement;
  align: FloatingAlign;
  gap: number;
  viewportPadding: number;
  safeArea?: FloatingSafeArea;
  sizeLimit?: FloatingSizeLimit;
  flip?: boolean;
};

export type FloatingLayoutResult = {
  placement: FloatingPlacement;
  left: number;
  top: number;
  maxHeight: number;
  maxWidth: number;
  scrollable: boolean;
};

const OPPOSITE_PLACEMENT: Record<FloatingPlacement, FloatingPlacement> = {
  above: "below",
  below: "above",
  left: "right",
  right: "left",
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

export function computeFloatingLayout({
  anchorRect,
  floatingWidth,
  floatingHeight,
  viewport,
  preferredPlacement,
  align,
  gap,
  viewportPadding,
  safeArea = {},
  sizeLimit = {},
  flip = true,
}: FloatingLayoutInput): FloatingLayoutResult {
  const safeLeft = viewport.left + viewportPadding + (safeArea.left ?? 0);
  const safeTop = viewport.top + viewportPadding + (safeArea.top ?? 0);
  const safeRight =
    viewport.left + viewport.width - viewportPadding - (safeArea.right ?? 0);
  const safeBottom =
    viewport.top + viewport.height - viewportPadding - (safeArea.bottom ?? 0);
  const widthLimit = Math.max(0, sizeLimit.width ?? Number.POSITIVE_INFINITY);
  const heightLimit = Math.max(0, sizeLimit.height ?? Number.POSITIVE_INFINITY);
  const maxWidth = Math.min(Math.max(0, safeRight - safeLeft), widthLimit);
  const renderWidth = Math.min(Math.max(floatingWidth, 0), maxWidth);
  const safeHeight = Math.max(0, safeBottom - safeTop);
  const available = {
    below: Math.max(0, safeBottom - (anchorRect.bottom + gap)),
    above: Math.max(0, anchorRect.top - gap - safeTop),
    right: Math.max(0, safeRight - (anchorRect.right + gap)),
    left: Math.max(0, anchorRect.left - gap - safeLeft),
  };
  const oppositePlacement = OPPOSITE_PLACEMENT[preferredPlacement];
  const verticalPlacement = preferredPlacement === "above" || preferredPlacement === "below";
  const requiredSpace = verticalPlacement
    ? Math.min(floatingHeight, heightLimit)
    : Math.min(floatingWidth, widthLimit);
  const placement = !flip || requiredSpace <= available[preferredPlacement]
    ? preferredPlacement
    : requiredSpace <= available[oppositePlacement]
      ? oppositePlacement
      : available[preferredPlacement] >= available[oppositePlacement]
        ? preferredPlacement
        : oppositePlacement;
  const placedVertically = placement === "above" || placement === "below";
  const maxHeight = Math.min(
    placedVertically ? available[placement] : safeHeight,
    heightLimit,
  );
  const renderHeight = Math.min(Math.max(floatingHeight, 0), maxHeight);
  const anchorCenter = (anchorRect.left + anchorRect.right) / 2;
  const anchorMiddle = (anchorRect.top + anchorRect.bottom) / 2;
  const alignedLeft = align === "start"
    ? anchorRect.left
    : align === "end"
      ? anchorRect.right - renderWidth
      : anchorCenter - renderWidth / 2;
  const alignedTop = align === "start"
    ? anchorRect.top
    : align === "end"
      ? anchorRect.bottom - renderHeight
      : anchorMiddle - renderHeight / 2;
  const rawLeft = placement === "right"
    ? anchorRect.right + gap
    : placement === "left"
      ? anchorRect.left - gap - renderWidth
      : alignedLeft;
  const rawTop = placement === "below"
    ? anchorRect.bottom + gap
    : placement === "above"
      ? anchorRect.top - gap - renderHeight
      : alignedTop;

  return {
    placement,
    left: clamp(rawLeft, safeLeft, Math.max(safeLeft, safeRight - renderWidth)),
    top: clamp(rawTop, safeTop, Math.max(safeTop, safeBottom - renderHeight)),
    maxHeight,
    maxWidth,
    scrollable: floatingHeight > maxHeight + 0.5,
  };
}