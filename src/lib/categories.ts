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
