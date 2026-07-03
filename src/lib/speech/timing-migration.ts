import { prisma } from "@/lib/prisma";
import { createLogger } from "@/lib/observability/logger";
import {
  legacySpeechWordsToTimingPayloadV2,
  type SpeechTimingProvider,
} from "./timing";

const log = createLogger("speech");
const DEFAULT_TIMING_PROVIDER = "azure";
const MALFORMED_LEGACY_PAYLOAD_ERROR = "Malformed legacy timing payload";

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

type SpeechTimingMigrationRow = {
  id: string;
  articleId: string;
  words: unknown;
};

function takeOption(limit: number | undefined): { take: number } | object {
  return limit ? { take: limit } : {};
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function logMigrationFailure(articleId: string, error: unknown): void {
  log.error("speech.timing_migration_failed", {
    articleId,
    error: errorMessage(error),
  });
}

async function findArticleSpeechRows(limit: number | undefined): Promise<SpeechTimingMigrationRow[]> {
  return prisma.articleSpeech.findMany({
    select: {
      id: true,
      articleId: true,
      words: true,
    },
    ...takeOption(limit),
  });
}

/**
 * Converts legacy raw ArticleSpeech.words arrays into the canonical V2 timing
 * payload. Safe to re-run: rows that already store V2 objects are skipped.
 */
export async function migrateArticleSpeechTimingsToV2(
  opts: SpeechTimingMigrationOptions = {},
): Promise<SpeechTimingMigrationResult> {
  const rows = await findArticleSpeechRows(opts.limit);

  let migrated = 0;
  let skippedCurrent = 0;
  let failed = 0;
  const provider = opts.provider ?? DEFAULT_TIMING_PROVIDER;

  for (const row of rows) {
    if (!Array.isArray(row.words)) {
      skippedCurrent += 1;
      continue;
    }

    const payload = legacySpeechWordsToTimingPayloadV2(row.words, provider);
    if (!payload) {
      failed += 1;
      logMigrationFailure(row.articleId, MALFORMED_LEGACY_PAYLOAD_ERROR);
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
      logMigrationFailure(row.articleId, err);
    }
  }

  return {
    scanned: rows.length,
    migrated,
    skippedCurrent,
    failed,
  };
}
