/**
 * Segment types and the `resolveSegmentUserIds` loader that maps a
 * (level, topic) segment into a concrete list of matching user IDs via
 * `Profile`. Topic filtering is done in TypeScript because `Profile.topics`
 * is a JSON string array (no portable SQL filter).
 */
import { prisma } from "@/lib/prisma";
import { parseTopics } from "@/features/profile-preferences/schema";

type ProfileClient = Pick<typeof prisma, "profile">;

export type AnalyticsSegment = {
  /** CEFR English level filter (matched against Profile.englishLevel). */
  level?: string | null;
  /** Topic-interest filter (matched against Profile.topics). */
  topic?: string | null;
};

export type SegmentResolver = (
  segment: AnalyticsSegment,
) => Promise<string[] | null>;

/**
 * Resolves the set of user ids matching a segment (level/topic) against
 * `Profile`. Returns `null` when no segment is requested (no user filter), or
 * an array (possibly empty) of matching user ids.
 */
export async function resolveSegmentUserIds(
  segment: AnalyticsSegment,
  client: ProfileClient = prisma,
): Promise<string[] | null> {
  const level = segment.level?.trim() || null;
  const topic = segment.topic?.trim() || null;
  if (!level && !topic) return null;

  if (level && !topic) {
    const rows = await client.profile.findMany({
      where: { englishLevel: level },
      select: { userId: true },
    });
    return rows.map((r) => r.userId);
  }

  // Topic (optionally + level) requires parsing the JSON topics column.
  const rows = await client.profile.findMany({
    where: level ? { englishLevel: level } : {},
    select: { userId: true, topics: true },
  });
  if (!topic) return rows.map((r) => r.userId);
  return rows
    .filter((r) => parseTopics(r.topics).includes(topic))
    .map((r) => r.userId);
}
