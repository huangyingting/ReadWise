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

const PADDING = 4;
const SVG_BLOCK_STYLE = { display: "block" } as const;

type SparklinePoint = [x: number, y: number];

function clampValue(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function getSparklinePoints({
  values,
  coordWidth,
  height,
  min,
  max,
}: Required<
  Pick<SparklineProps, "values" | "coordWidth" | "height" | "min" | "max">
>): SparklinePoint[] {
  const innerWidth = coordWidth - PADDING * 2;
  const innerHeight = height - PADDING * 2;
  const range = max - min || 1;
  const toX = (index: number) =>
    values.length === 1
      ? PADDING + innerWidth / 2
      : PADDING + (index / (values.length - 1)) * innerWidth;
  const toY = (value: number) =>
    PADDING + (1 - (clampValue(value, min, max) - min) / range) * innerHeight;

  return values.map((value, index) => [toX(index), toY(value)]);
}

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

  const pointPairs = getSparklinePoints({
    values,
    coordWidth,
    height,
    min,
    max,
  });

  // Single-point degenerate: just a centred dot
  if (values.length === 1) {
    const [cx, cy] = pointPairs[0];
    return (
      <figure className="rw-spark m-0 p-0">
        <span className="sr-only">{label}</span>
        <svg
          width="100%"
          height={height}
          viewBox={`0 0 ${coordWidth} ${height}`}
          preserveAspectRatio="none"
          aria-hidden="true"
          style={SVG_BLOCK_STYLE}
        >
          <circle cx={cx} cy={cy} r={3} fill={accentVar} />
        </svg>
      </figure>
    );
  }

  const pointsStr = pointPairs.map(([x, y]) => `${x},${y}`).join(" ");

  // Area polygon closes the line down to the baseline
  const lastX = pointPairs[pointPairs.length - 1][0];
  const firstX = pointPairs[0][0];
  const bottomY = height - PADDING;
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
        style={SVG_BLOCK_STYLE}
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
