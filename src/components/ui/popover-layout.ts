export type PopoverAlign = "start" | "end";
export type PopoverPlacement = "below" | "above";

export interface PopoverViewport {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface PopoverLayoutInput {
  anchorRect: Pick<DOMRect, "top" | "right" | "bottom" | "left">;
  panelWidth: number;
  panelHeight: number;
  viewport: PopoverViewport;
  align: PopoverAlign;
  gap: number;
  viewportPadding: number;
}

export interface PopoverLayoutResult {
  placement: PopoverPlacement;
  left: number;
  top: number;
  maxHeight: number;
  maxWidth: number;
  scrollable: boolean;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

export function computePopoverLayout({
  anchorRect,
  panelWidth,
  panelHeight,
  viewport,
  align,
  gap,
  viewportPadding,
}: PopoverLayoutInput): PopoverLayoutResult {
  const viewportRight = viewport.left + viewport.width;
  const viewportBottom = viewport.top + viewport.height;
  const safeLeft = viewport.left + viewportPadding;
  const safeTop = viewport.top + viewportPadding;
  const safeRight = viewportRight - viewportPadding;
  const safeBottom = viewportBottom - viewportPadding;

  const maxWidth = Math.max(0, safeRight - safeLeft);
  const renderWidth = Math.min(Math.max(panelWidth, 0), maxWidth);
  const availableBelow = Math.max(0, safeBottom - (anchorRect.bottom + gap));
  const availableAbove = Math.max(0, anchorRect.top - gap - safeTop);
  const canFitBelow = panelHeight <= availableBelow;
  const canFitAbove = panelHeight <= availableAbove;

  const placement: PopoverPlacement = canFitBelow
    ? "below"
    : canFitAbove
      ? "above"
      : availableBelow >= availableAbove
        ? "below"
        : "above";

  const maxHeight = Math.max(
    0,
    placement === "below" ? availableBelow : availableAbove,
  );
  const renderHeight = Math.min(Math.max(panelHeight, 0), maxHeight);
  const rawTop =
    placement === "below"
      ? anchorRect.bottom + gap
      : anchorRect.top - gap - renderHeight;
  const maxTop = Math.max(safeTop, safeBottom - renderHeight);
  const top = clamp(rawTop, safeTop, maxTop);

  const rawLeft =
    align === "end" ? anchorRect.right - renderWidth : anchorRect.left;
  const maxLeft = Math.max(safeLeft, safeRight - renderWidth);
  const left = clamp(rawLeft, safeLeft, maxLeft);

  return {
    placement,
    left,
    top,
    maxHeight,
    maxWidth,
    scrollable: panelHeight > maxHeight + 0.5,
  };
}
