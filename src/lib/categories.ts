/**
 * How well-suited a category's content tends to be for English READING practice.
 * Favors substantive, evergreen, well-structured prose:
 *  - "high":   science, ideas, culture, history, environment, animals, travel, health
 *  - "medium": world, tech, business, entertainment
 *  - "low":    politics, sports
 */
export type ReadingSuitability = "high" | "medium" | "low";

export type Category = {
  slug: string;
  label: string;
  /** English-reading-suitability tier for this category. */
  readingSuitability: ReadingSuitability;
};

export const CATEGORIES: readonly Category[] = [
  { slug: "world", label: "World", readingSuitability: "medium" },
  { slug: "politics", label: "Politics", readingSuitability: "low" },
  { slug: "business", label: "Business", readingSuitability: "medium" },
  { slug: "health", label: "Health", readingSuitability: "high" },
  { slug: "science", label: "Science", readingSuitability: "high" },
  { slug: "environment", label: "Environment", readingSuitability: "high" },
  { slug: "animals", label: "Animals", readingSuitability: "high" },
  { slug: "tech", label: "Tech", readingSuitability: "medium" },
  { slug: "sports", label: "Sports", readingSuitability: "low" },
  { slug: "culture", label: "Culture", readingSuitability: "high" },
  { slug: "history", label: "History", readingSuitability: "high" },
  { slug: "travel", label: "Travel", readingSuitability: "high" },
  { slug: "ideas", label: "Ideas", readingSuitability: "high" },
  { slug: "entertainment", label: "Entertainment", readingSuitability: "medium" },
] as const;

export const CATEGORY_SLUGS: readonly string[] = CATEGORIES.map((c) => c.slug);

/** Deterministic gradient tints for each category — used by card placeholders. */
export const CATEGORY_COLORS: Record<string, { from: string; to: string }> = {
  world:         { from: "#3b82f6", to: "#1d4ed8" },
  politics:      { from: "#ef4444", to: "#b91c1c" },
  business:      { from: "#f59e0b", to: "#d97706" },
  health:        { from: "#10b981", to: "#059669" },
  science:       { from: "#6366f1", to: "#4338ca" },
  environment:   { from: "#22c55e", to: "#15803d" },
  animals:       { from: "#fb923c", to: "#c2410c" },
  tech:          { from: "#8b5cf6", to: "#6d28d9" },
  sports:        { from: "#f97316", to: "#ea580c" },
  culture:       { from: "#ec4899", to: "#db2777" },
  history:       { from: "#b45309", to: "#78350f" },
  travel:        { from: "#06b6d4", to: "#0e7490" },
  ideas:         { from: "#a855f7", to: "#7e22ce" },
  entertainment: { from: "#14b8a6", to: "#0d9488" },
};

/** Returns the gradient pair for the given category slug, with a neutral fallback. */
export function categoryGradient(slug: string | null | undefined): { from: string; to: string } {
  return (slug != null && CATEGORY_COLORS[slug]) || { from: "#64748b", to: "#475569" };
}

export function isValidCategorySlug(slug: string): boolean {
  return CATEGORY_SLUGS.includes(slug);
}

/**
 * Returns the registered label for a known slug (e.g. "tech" → "Tech"),
 * or a humanized fallback for unknown slugs (hyphens/underscores → spaces,
 * each word Title-Cased) — never returns a raw lowercase slug.
 */
export function humanizeCategorySlug(slug: string): string {
  const registered = CATEGORIES.find((c) => c.slug === slug);
  if (registered) return registered.label;
  return slug
    .split(/[-_]+/)
    .map((w) => (w.length > 0 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

/** Numeric weight for each reading-suitability tier (high best, low worst). */
const READING_SUITABILITY_RANKS: Record<ReadingSuitability, number> = {
  high: 1.0,
  medium: 0.6,
  low: 0.25,
};

/**
 * Returns the reading-suitability tier for a category slug. Unknown or null
 * slugs default to "medium" so they neither earn a boost nor a penalty.
 */
export function readingSuitabilityOf(slug: string | null): ReadingSuitability {
  if (slug == null) return "medium";
  return CATEGORIES.find((c) => c.slug === slug)?.readingSuitability ?? "medium";
}

/**
 * Numeric reading-suitability rank for a category slug: high=1.0, medium=0.6,
 * low=0.25. Unknown/null slugs fall back to the "medium" rank (0.6).
 */
export function readingSuitabilityRank(slug: string | null): number {
  return READING_SUITABILITY_RANKS[readingSuitabilityOf(slug)];
}

/** High + medium suitability slugs — the categories recommended for reading practice. */
export const READING_RECOMMENDED_CATEGORIES: readonly string[] = CATEGORIES.filter(
  (c) => c.readingSuitability !== "low",
).map((c) => c.slug);

/**
 * True when a category is recommended for reading practice (high or medium
 * suitability). Unknown/null slugs default to "medium" → recommended.
 */
export function isReadingRecommended(slug: string | null): boolean {
  return readingSuitabilityOf(slug) !== "low";
}
