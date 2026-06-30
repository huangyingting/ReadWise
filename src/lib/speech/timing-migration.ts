import { prisma } from "@/lib/prisma";
import { createLogger } from "@/lib/observability/logger";
import {
  legacySpeechWordsToTimingPayloadV2,
  type SpeechTimingProvider,
} from "./timing";

const log = createLogger("speech");

export type SpeechTimingMigrationResult = {
  scanned: number;
  migrated: number;
  skippedCurrent: number;
  failed: number;
};

type SpeechTimingMigrationOptions = {
  limit?: number;
  provider?: SpeechTimingProvider | string;
};

/**
 * Converts legacy raw ArticleSpeech.words arrays into the canonical V2 timing
 * payload. Safe to re-run: rows that already store V2 objects are skipped.
 */
export async function migrateArticleSpeechTimingsToV2(
  opts: SpeechTimingMigrationOptions = {},
): Promise<SpeechTimingMigrationResult> {
  const rows = await prisma.articleSpeech.findMany({
    select: {
      id: true,
      articleId: true,
      words: true,
    },
    ...(opts.limit ? { take: opts.limit } : {}),
  });

  let migrated = 0;
  let skippedCurrent = 0;
  let failed = 0;
  const provider = opts.provider ?? "azure";

  for (const row of rows) {
    if (!Array.isArray(row.words)) {
      skippedCurrent += 1;
      continue;
    }

    const payload = legacySpeechWordsToTimingPayloadV2(row.words, provider);
    if (!payload) {
      failed += 1;
      log.error("speech.timing_migration_failed", {
        articleId: row.articleId,
        error: "Malformed legacy timing payload",
      });
      continue;
    }

    try {
      await prisma.articleSpeech.update({
        where: { id: row.id },
        data: { words: payload },
      });
      migrated += 1;
    } catch (err) {
      failed += 1;
      log.error("speech.timing_migration_failed", {
        articleId: row.articleId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    scanned: rows.length,
    migrated,
    skippedCurrent,
    failed,
  };
}
