/**
 * Content maturity bands (#1302): age/topic appropriateness, separate from
 * linguistic difficulty (CEFR / Lexile). Client-safe.
 *
 * `general` means suitable for every audience and is the default for new and
 * existing articles until an editor classifies them. Bands are ordered, so a
 * reader filtering for a band sees content suitable at or below it, plus
 * `general` content.
 */

export const MATURITY_BANDS = ["elementary", "middle_school", "high_school", "general"] as const;

export type MaturityBand = (typeof MATURITY_BANDS)[number];

export const DEFAULT_MATURITY_BAND: MaturityBand = "general";

export const MATURITY_BAND_LABELS: Record<MaturityBand, string> = {
  elementary: "Elementary",
  middle_school: "Middle school",
  high_school: "High school",
  general: "General audience",
};

/** Bands a reader can filter on, youngest first (`general` is implied). */
export const FILTERABLE_MATURITY_BANDS = ["elementary", "middle_school", "high_school"] as const satisfies readonly MaturityBand[];

export function isMaturityBand(value: unknown): value is MaturityBand {
  return typeof value === "string" && (MATURITY_BANDS as readonly string[]).includes(value);
}

/** Bands suitable for a reader filtering on `band`: at or below it, plus general. */
export function maturityBandsSuitableFor(band: MaturityBand): MaturityBand[] {
  if (band === "general") return ["general"];
  const rank = FILTERABLE_MATURITY_BANDS.indexOf(band);
  return [...FILTERABLE_MATURITY_BANDS.slice(0, rank + 1), "general"];
}
