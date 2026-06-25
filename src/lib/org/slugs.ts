/**
 * Organization slug utilities.
 *
 * Produces URL-safe, unique slugs for org names. These are pure helpers — they
 * import only the Prisma singleton to check slug availability.
 */
import { prisma } from "@/lib/prisma";

/** URL-safe slug for an organization name (lowercase, hyphenated). */
export function slugifyOrg(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Returns a slug not currently used by any org. Tries `base`, then `base-2`,
 * `base-3`, … An empty base falls back to `org`.
 */
export async function ensureUniqueOrgSlug(base: string): Promise<string> {
  const root = base || "org";
  let candidate = root;
  let n = 2;
  while (n < 1000) {
    const existing = await prisma.organization.findUnique({
      where: { slug: candidate },
      select: { id: true },
    });
    if (!existing) return candidate;
    candidate = `${root}-${n}`;
    n++;
  }
  return `${root}-${Date.now()}`;
}
