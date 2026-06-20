/**
 * Sparkline — presentational teal SVG line/area chart for recent quiz scores.
 * Used by MasteryWidget (dashboard) and the Study Comprehension section.
 *
 * The <svg> is aria-hidden; a visually-hidden <figcaption> inside a <figure>
 * carries the accessible label. No JS dependencies; pure SVG math.
 *
 * Reduced-motion: the sparkline itself never animates. The optional
 * rw-spark-draw line-draw (class on <polyline>) is gated behind
 * prefers-reduced-motion: no-preference in globals.css.
 */

type SparklineProps = {
  values: number[]; // scorePct oldest→newest
  label: string; // full sr text, e.g. "Recent quiz scores: 60, 80, 70 percent."
  /** Coordinate-system width (SVG viewBox). SVG renders width="100%" to fill container. */
  coordWidth?: number; // default 200
  height?: number; // default 40
  min?: number; // default 0
  max?: number; // default 100
  /**
   * CSS variable for stroke/fill.
   * Use "var(--reading-accent, var(--teal))" when inside the reader panel.
   * Default: "var(--teal)"
   */
  accentVar?: string;
};

export default function Sparkline({
  values,
  label,
  coordWidth = 200,
  height = 40,
  min = 0,
  max = 100,
  accentVar = "var(--teal)",
}: SparklineProps) {
  if (values.length === 0) return null;

  const PAD = 4;
  const innerW = coordWidth - PAD * 2;
  const innerH = height - PAD * 2;
  const range = max - min || 1;

  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  const toX = (i: number) =>
    values.length === 1
      ? PAD + innerW / 2
      : PAD + (i / (values.length - 1)) * innerW;
  const toY = (v: number) =>
    PAD + (1 - (clamp(v) - min) / range) * innerH;

  // Single-point degenerate: just a centred dot
  if (values.length === 1) {
    const cx = toX(0);
    const cy = toY(values[0]);
    return (
      <figure className="rw-spark m-0 p-0">
        <span className="sr-only">{label}</span>
        <svg
          width="100%"
          height={height}
          viewBox={`0 0 ${coordWidth} ${height}`}
          preserveAspectRatio="none"
          aria-hidden="true"
          style={{ display: "block" }}
        >
          <circle cx={cx} cy={cy} r={3} fill={accentVar} />
        </svg>
      </figure>
    );
  }

  const pointPairs = values.map((v, i) => [toX(i), toY(v)] as [number, number]);
  const pointsStr = pointPairs.map(([x, y]) => `${x},${y}`).join(" ");

  // Area polygon closes the line down to the baseline
  const lastX = pointPairs[pointPairs.length - 1][0];
  const firstX = pointPairs[0][0];
  const bottomY = height - PAD;
  const areaPoints = `${pointsStr} ${lastX},${bottomY} ${firstX},${bottomY}`;

  const [lastCx, lastCy] = pointPairs[pointPairs.length - 1];

  return (
    <figure className="rw-spark m-0 p-0">
      <span className="sr-only">{label}</span>
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 ${coordWidth} ${height}`}
        preserveAspectRatio="none"
        aria-hidden="true"
        style={{ display: "block" }}
      >
        {/* Subtle area fill */}
        <polygon
          points={areaPoints}
          fill={`color-mix(in srgb, ${accentVar} 12%, transparent)`}
        />
        {/* Main line */}
        <polyline
          points={pointsStr}
          fill="none"
          stroke={accentVar}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="rw-spark-line"
        />
        {/* Latest-point anchor dot */}
        <circle cx={lastCx} cy={lastCy} r={3} fill={accentVar} />
      </svg>
    </figure>
  );
}
