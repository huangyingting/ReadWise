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
