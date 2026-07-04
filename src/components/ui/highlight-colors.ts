import {
  HIGHLIGHT_COLORS,
  type HighlightColor,
} from "@/lib/annotations/anchor";

const HIGHLIGHT_COLOR_LABELS: Record<HighlightColor, string> = {
  yellow: "Yellow",
  green: "Green",
  blue: "Blue",
  pink: "Pink",
};

export type HighlightColorTone = "fill" | "dot";

export const HIGHLIGHT_COLOR_OPTIONS = HIGHLIGHT_COLORS.map((color) => ({
  color,
  label: HIGHLIGHT_COLOR_LABELS[color],
  fillVar: `var(--hl-${color})`,
  dotVar: `var(--hl-dot-${color})`,
})) satisfies ReadonlyArray<{
  color: HighlightColor;
  label: string;
  fillVar: string;
  dotVar: string;
}>;

export function isHighlightColor(
  value: string | null | undefined,
): value is HighlightColor {
  return HIGHLIGHT_COLORS.includes(value as HighlightColor);
}

export function getHighlightColorLabel(color: HighlightColor): string {
  return HIGHLIGHT_COLOR_LABELS[color];
}

export function getHighlightColorCssVar(
  color: HighlightColor,
  tone: HighlightColorTone = "fill",
): string {
  return tone === "dot" ? `var(--hl-dot-${color})` : `var(--hl-${color})`;
}

export { HIGHLIGHT_COLORS };
export type { HighlightColor };
