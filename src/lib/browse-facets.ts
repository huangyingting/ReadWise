/**
 * Browse facet parsing (#1302): `?maturity=` and `?skill=` URL params, shared
 * by the browse page and `/api/articles`. Unknown values are ignored.
 */
import { FILTERABLE_MATURITY_BANDS, type MaturityBand } from "@/lib/article-library/maturity";
import { isReadingSkill, type ReadingSkill } from "@/lib/learning/reading-skills";

export type BrowseFacets = {
  maturityBand: MaturityBand | null;
  skill: ReadingSkill | null;
};

export function parseBrowseFacets(params: {
  maturity?: string | null;
  skill?: string | null;
}): BrowseFacets {
  const maturity = params.maturity ?? null;
  return {
    maturityBand: (FILTERABLE_MATURITY_BANDS as readonly string[]).includes(maturity ?? "")
      ? (maturity as MaturityBand)
      : null,
    skill: isReadingSkill(params.skill) ? params.skill : null,
  };
}
