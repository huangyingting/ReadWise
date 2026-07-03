/**
 * Organization slug utilities.
 *
 * Produces URL-safe, unique slugs for org names. These are pure helpers — they
 * import only the Prisma singleton to check slug availability.
 */
import { prisma } from "@/lib/prisma";

const ORG_SLUG_FALLBACK = "org";
const MAX_UNIQUE_SLUG_ATTEMPT = 1000;
const COMBINING_MARKS = /[\u0300-\u036f]/g;
const AMPERSAND = /&/g;
const NON_SLUG_CHARS = /[^a-z0-9]+/g;
const EDGE_HYPHENS = /^-+|-+$/g;

function suffixedSlug(root: string, suffix: number): string {
  return `${root}-${suffix}`;
}

/** URL-safe slug for an organization name (lowercase, hyphenated). */
export function slugifyOrg(name: string): string {
  return name
    .normalize("NFKD")
    .replace(COMBINING_MARKS, "")
    .toLowerCase()
    .replace(AMPERSAND, " and ")
    .replace(NON_SLUG_CHARS, "-")
    .replace(EDGE_HYPHENS, "");
}

/**
 * Returns a slug not currently used by any org. Tries `base`, then `base-2`,
 * `base-3`, … An empty base falls back to `org`.
 */
export async function ensureUniqueOrgSlug(base: string): Promise<string> {
  const root = base || ORG_SLUG_FALLBACK;
  let candidate = root;
  for (let suffix = 2; suffix < MAX_UNIQUE_SLUG_ATTEMPT; suffix += 1) {
    const existing = await prisma.organization.findUnique({
      where: { slug: candidate },
      select: { id: true },
    });
    if (!existing) return candidate;
    candidate = suffixedSlug(root, suffix);
  }
  return `${root}-${Date.now()}`;
}
