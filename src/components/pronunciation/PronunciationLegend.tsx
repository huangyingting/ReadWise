"use client";

export function PronunciationLegend() {
  return (
    <div className="rw-speak-legend" aria-label="Word feedback legend">
      <span className="rw-speak-legend-item">
        <span className="rw-speak-legend-swatch rw-speak-legend-swatch--good" aria-hidden />
        solid = good
      </span>
      <span className="rw-speak-legend-item">
        <span className="rw-speak-legend-swatch rw-speak-legend-swatch--fair" aria-hidden />
        dashed = close
      </span>
      <span className="rw-speak-legend-item">
        <span className="rw-speak-legend-swatch rw-speak-legend-swatch--poor" aria-hidden />
        wavy = needs work
      </span>
      <span className="rw-speak-legend-item">
        <span className="rw-speak-legend-swatch rw-speak-legend-swatch--omit" aria-hidden />
        <s aria-hidden>word</s> = skipped
      </span>
    </div>
  );
}
