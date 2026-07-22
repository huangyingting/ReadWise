/**
 * Category → translation-profile grouping for the provider-db prompt lab.
 *
 * The 14 distinct `Article.category` values observed across
 * `prisma/provider-dbs/*.db` cluster into four registers that need distinct
 * translation guidance (terminology handling, tone, transliteration rules).
 * Grouping keeps the prompt set small and maintainable instead of hand-tuning
 * 14 near-duplicate prompts.
 */

export type TranslationProfile = "news" | "technical" | "narrative" | "sports";

/** Every `Article.category` value seen across the provider databases. */
export const ALL_CATEGORIES = [
  "animals",
  "business",
  "culture",
  "entertainment",
  "environment",
  "health",
  "history",
  "ideas",
  "politics",
  "science",
  "sports",
  "tech",
  "travel",
  "world",
] as const;

export type ArticleCategory = (typeof ALL_CATEGORIES)[number];

/**
 * Maps each category to the translation profile whose register/terminology
 * rules best fit it. `environment` and `health` lean technical (units, named
 * substances/species, clinical or scientific claims that must stay precise);
 * `ideas` and `animals` lean narrative (essay/feature prose, not hard news).
 */
export const CATEGORY_PROFILE: Record<ArticleCategory, TranslationProfile> = {
  business: "news",
  politics: "news",
  world: "news",

  tech: "technical",
  science: "technical",
  health: "technical",
  environment: "technical",

  culture: "narrative",
  entertainment: "narrative",
  history: "narrative",
  travel: "narrative",
  ideas: "narrative",
  animals: "narrative",

  sports: "sports",
};

export function profileForCategory(category: string | null | undefined): TranslationProfile {
  if (category && category in CATEGORY_PROFILE) {
    return CATEGORY_PROFILE[category as ArticleCategory];
  }
  // Unknown/missing category: narrative is the safest general-purpose register.
  return "narrative";
}

export const ALL_PROFILES: TranslationProfile[] = ["news", "technical", "narrative", "sports"];
