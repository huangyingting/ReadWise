export type Category = {
  slug: string;
  label: string;
};

export const CATEGORIES: readonly Category[] = [
  { slug: "world", label: "World" },
  { slug: "politics", label: "Politics" },
  { slug: "business", label: "Business" },
  { slug: "health", label: "Health" },
  { slug: "science", label: "Science" },
  { slug: "tech", label: "Tech" },
  { slug: "sports", label: "Sports" },
  { slug: "culture", label: "Culture" },
  { slug: "entertainment", label: "Entertainment" },
] as const;

export const CATEGORY_SLUGS: readonly string[] = CATEGORIES.map((c) => c.slug);

/** Deterministic gradient tints for each category — used by card placeholders. */
export const CATEGORY_COLORS: Record<string, { from: string; to: string }> = {
  world:         { from: "#3b82f6", to: "#1d4ed8" },
  politics:      { from: "#ef4444", to: "#b91c1c" },
  business:      { from: "#f59e0b", to: "#d97706" },
  health:        { from: "#10b981", to: "#059669" },
  science:       { from: "#6366f1", to: "#4338ca" },
  tech:          { from: "#8b5cf6", to: "#6d28d9" },
  sports:        { from: "#f97316", to: "#ea580c" },
  culture:       { from: "#ec4899", to: "#db2777" },
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
