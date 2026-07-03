/**
 * Segment types and the `resolveSegmentUserIds` loader that maps a
 * (level, topic) segment into a concrete list of matching user IDs via
 * `Profile`. Topic filtering is done in TypeScript because `Profile.topics`
 * is a JSON string array (no portable SQL filter).
 */
import { prisma } from "@/lib/prisma";
import { parseTopics } from "@/lib/profile";

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

type ProfileUserRow = { userId: string };
type ProfileTopicRow = ProfileUserRow & { topics: Parameters<typeof parseTopics>[0] };

function segmentFilter(value: string | null | undefined): string | null {
  return value?.trim() || null;
}

function userIds(rows: ProfileUserRow[]): string[] {
  return rows.map((row) => row.userId);
}

function hasTopic(row: ProfileTopicRow, topic: string): boolean {
  return parseTopics(row.topics).includes(topic);
}

/**
 * Resolves the set of user ids matching a segment (level/topic) against
 * `Profile`. Returns `null` when no segment is requested (no user filter), or
 * an array (possibly empty) of matching user ids.
 */
export async function resolveSegmentUserIds(
  segment: AnalyticsSegment,
  client: ProfileClient = prisma,
): Promise<string[] | null> {
  const level = segmentFilter(segment.level);
  const topic = segmentFilter(segment.topic);
  if (!level && !topic) return null;

  if (level && !topic) {
    const rows = await client.profile.findMany({
      where: { englishLevel: level },
      select: { userId: true },
    });
    return userIds(rows);
  }

  // Topic (optionally + level) requires parsing the JSON topics column.
  const rows = await client.profile.findMany({
    where: level ? { englishLevel: level } : {},
    select: { userId: true, topics: true },
  });
  if (!topic) return userIds(rows);
  return rows
    .filter((row) => hasTopic(row, topic))
    .map((row) => row.userId);
}
