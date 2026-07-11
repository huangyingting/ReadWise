/**
 * Source/category reading-suitability contract.
 *
 * Recommendations only needs to know whether a (source, category) pair should
 * be treated as reading-suitable by provider override rules; it should not
 * depend on provider registry internals directly.
 */
import {
  getProviderByName,
  isProviderCategoryReadingSuitable,
} from "@/lib/scraper/providers";

/**
 * True when `source` resolves to a provider with an explicit
 * `readingCategories` override and `category` is allowed by that override.
 */
export function isSourceCategoryReadingSuitable(
  source: string | null,
  category: string | null,
): boolean {
  if (source == null || category == null) return false;
  const provider = getProviderByName(source);
  return (
    provider?.readingCategories != null &&
    isProviderCategoryReadingSuitable(provider, category)
  );
}
