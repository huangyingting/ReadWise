/**
 * Request helpers for level-scoped reader routes (#1303).
 */
import { ApiError } from "@/lib/errors/api-error";
import { ORIGINAL_LEVEL, isReadingLevelKey, type ReadingLevelKey } from "./levels";
import { getArticleLevelVariant, type ArticleLevelVariant } from "./variants";

/** Parses `?level=` (absent = "original"); unknown levels are a 400. */
export function parseLevelParam(
  params: URLSearchParams,
): { ok: true; value: ReadingLevelKey } | { ok: false; error: string } {
  const raw = params.get("level");
  if (raw === null || raw === "") return { ok: true, value: ORIGINAL_LEVEL };
  return isReadingLevelKey(raw) ? { ok: true, value: raw } : { ok: false, error: "level is not a known reading level" };
}

/** Query parser for routes whose only query input is `level`. */
export function levelQuery(params: URLSearchParams) {
  const parsed = parseLevelParam(params);
  return parsed.ok ? { ok: true as const, value: { level: parsed.value } } : parsed;
}

/**
 * The adapted variant for a level (null for "original"). Throws 404 when the
 * article has no such level. Callers must have checked article readability.
 */
export async function requireArticleLevel(
  articleId: string,
  level: ReadingLevelKey,
): Promise<ArticleLevelVariant | null> {
  if (level === ORIGINAL_LEVEL) return null;
  const variant = await getArticleLevelVariant(articleId, level);
  if (!variant) throw new ApiError(404, "Reading level not found");
  return variant;
}
