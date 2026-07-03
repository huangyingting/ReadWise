"use client";

import type { ReactNode } from "react";

type LegendItem = {
  swatchClassName: string;
  label: ReactNode;
};

const LEGEND_ITEMS: LegendItem[] = [
  {
    swatchClassName: "rw-speak-legend-swatch--good",
    label: "solid = good",
  },
  {
    swatchClassName: "rw-speak-legend-swatch--fair",
    label: "dashed = close",
  },
  {
    swatchClassName: "rw-speak-legend-swatch--poor",
    label: "wavy = needs work",
  },
  {
    swatchClassName: "rw-speak-legend-swatch--omit",
    label: (
      <>
        <s aria-hidden>word</s> = skipped
      </>
    ),
  },
];

export function PronunciationLegend() {
  return (
    <div className="rw-speak-legend" aria-label="Word feedback legend">
      {LEGEND_ITEMS.map(({ swatchClassName, label }) => (
        <span key={swatchClassName} className="rw-speak-legend-item">
          <span
            className={`rw-speak-legend-swatch ${swatchClassName}`}
            aria-hidden
          />
          {label}
        </span>
      ))}
    </div>
  );
}
