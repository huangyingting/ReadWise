import { prisma } from "@/lib/prisma";
import { createLogger } from "@/lib/observability/logger";
import type { SpeechWord } from "./timing";
import {
  createSpeechTimingPayloadV2,
  legacySpeechWordsToTimingPayloadV1,
  legacySpeechWordsToTimingPayloadV2,
  parseSpeechTimingPayload,
  type SpeechTimingPayloadV2,
  type SpeechTimingProvider,
} from "./timing-storage";
import { enrichSpeechTimingSpans } from "./timing-enrichment";
import {
  prepareNarrationText,
  resolveStoredNarrationTextBasis,
} from "./text-basis";

const log = createLogger("speech");
const DEFAULT_TIMING_PROVIDER = "azure";

export type SpeechTimingMigrationResult = {
  scanned: number;
  migrated: number;
  skippedCurrent: number;
  failed: number;
};

type SpeechTimingMigrationOptions = {
  limit?: number;
  provider?: SpeechTimingProvider | string;
  target?: "v1" | "v2";
};

type SpeechTimingMigrationRow = {
  id: string;
  articleId: string;
  words: unknown;
};

function takeOption(limit: number | undefined): { take: number } | object {
  return limit ? { take: limit } : {};
}

function logMigrationFailure(
  articleId: string,
  machineReason: "malformed_legacy_timing" | "timing_migration_failed",
): void {
  log.error("speech.timing_migration_failed", {
    articleId,
    machineReason,
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

function serializeLegacyWords(
  raw: unknown,
  provider: string,
  target: "v1" | "v2",
): ReturnType<typeof legacySpeechWordsToTimingPayloadV2> | ReturnType<typeof legacySpeechWordsToTimingPayloadV1> {
  return target === "v1"
    ? legacySpeechWordsToTimingPayloadV1(raw)
    : legacySpeechWordsToTimingPayloadV2(raw, provider);
}

/**
 * Converts legacy raw ArticleSpeech.words arrays to the requested timing
 * payload format. Defaults to V2 (canonical). Use `target: "v1"` for compact
 * V1 columnar output (migration tooling only). Safe to re-run: rows that
 * already store a non-array object are skipped.
 */
export async function migrateArticleSpeechTimings(
  opts: SpeechTimingMigrationOptions = {},
): Promise<SpeechTimingMigrationResult> {
  const rows = await findArticleSpeechRows(opts.limit);

  let migrated = 0;
  let skippedCurrent = 0;
  let failed = 0;
  const provider = opts.provider ?? DEFAULT_TIMING_PROVIDER;
  const target = opts.target ?? "v2";

  for (const row of rows) {
    if (!Array.isArray(row.words)) {
      skippedCurrent += 1;
      continue;
    }

    const payload = serializeLegacyWords(row.words, provider, target);
    if (!payload) {
      failed += 1;
      logMigrationFailure(row.articleId, "malformed_legacy_timing");
      continue;
    }

    try {
      await prisma.articleSpeech.update({
        where: { id: row.id },
        data: { words: payload },
      });
      migrated += 1;
    } catch {
      failed += 1;
      logMigrationFailure(row.articleId, "timing_migration_failed");
    }
  }

  return {
    scanned: rows.length,
    migrated,
    skippedCurrent,
    failed,
  };
}

/**
 * Convenience wrapper for V2 migration (backward-compatible alias).
 * Converts legacy raw ArticleSpeech.words arrays into the canonical V2 timing
 * payload. Safe to re-run: rows already storing V2 objects are skipped.
 */
export async function migrateArticleSpeechTimingsToV2(
  opts: Omit<SpeechTimingMigrationOptions, "target"> = {},
): Promise<SpeechTimingMigrationResult> {
  return migrateArticleSpeechTimings({ ...opts, target: "v2" });
}

// ── Span repair ──────────────────────────────────────────────────────────────

export type SpeechTimingRepairResult = {
  scanned: number;
  repaired: number;
  skippedHasSpans: number;
  skippedNoPlainText: number;
  skippedAlignment: number;
  failed: number;
};

export type SpeechTimingRepairOptions = {
  /** Run without writing to the database. */
  dryRun: boolean;
  /** Restrict to these article IDs. Omit to repair all rows missing spans. */
  ids?: string[];
  /** Maximum rows to process. */
  limit?: number;
};

type SpeechTimingRepairRow = {
  id: string;
  articleId: string;
  words: unknown;
  article: {
    content: string;
  };
};

/**
 * Determines whether a V2 payload is missing its textStart/textEnd span arrays
 * or has arrays of the wrong length.
 */
function v2MissingSpans(payload: SpeechTimingPayloadV2): boolean {
  const n = payload.words.length;
  return (
    !Array.isArray(payload.textStart) ||
    !Array.isArray(payload.textEnd) ||
    payload.textStart.length !== n ||
    payload.textEnd.length !== n
  );
}

/**
 * Idempotent repair pass for V2 ArticleSpeech rows that are missing their
 * textStart/textEnd span arrays. Derives the canonical reader text from the
 * related article to compute UTF-16 spans via alignment without re-synthesis.
 *
 * Semantics:
 *   - `dryRun: true`  — reports what would change, writes nothing.
 *   - `dryRun: false` — repairs rows in-place.
 *   - `ids`           — restrict to specific article IDs; omit for all rows.
 *   - `limit`         — cap the number of rows processed.
 *
 * Skips rows that already have valid equal-length span arrays (idempotent).
 * Throws if `ids` is provided as an empty array (explicit invalid input).
 */
export async function repairSpeechTimingSpans(
  opts: SpeechTimingRepairOptions,
): Promise<SpeechTimingRepairResult> {
  if (opts.ids !== undefined && opts.ids.length === 0) {
    throw new Error("--ids must not be empty when provided; omit to repair all rows");
  }

  const rows: SpeechTimingRepairRow[] = await prisma.articleSpeech.findMany({
    where: opts.ids !== undefined ? { articleId: { in: opts.ids } } : undefined,
    select: {
      id: true,
      articleId: true,
      words: true,
      article: {
        select: {
          content: true,
        },
      },
    },
    ...takeOption(opts.limit),
  });

  let repaired = 0;
  let skippedHasSpans = 0;
  let skippedNoPlainText = 0;
  let skippedAlignment = 0;
  let failed = 0;

  for (const row of rows) {
    // Only repair V2 rows — V1 and legacy arrays are outside scope.
    const rawPayload = row.words as Record<string, unknown>;
    if (!rawPayload || typeof rawPayload !== "object" || rawPayload.version !== 2) {
      skippedHasSpans += 1;
      continue;
    }
    const v2 = rawPayload as unknown as SpeechTimingPayloadV2;

    if (!v2MissingSpans(v2)) {
      skippedHasSpans += 1;
      continue;
    }

    const parsed = parseSpeechTimingPayload(row.words);
    if (!parsed) {
      skippedAlignment += 1;
      log.warn("speech.span_repair_parse_failed", { articleId: row.articleId });
      continue;
    }

    const basis = resolveStoredNarrationTextBasis(parsed.textBasis, parsed.provider);
    const plainText = prepareNarrationText(row.article.content, basis).plainText;
    if (!plainText) {
      skippedNoPlainText += 1;
      log.warn("speech.span_repair_no_plain_text", { articleId: row.articleId });
      continue;
    }

    const enriched = enrichSpeechTimingSpans(parsed.words, plainText);
    const newPayload = createSpeechTimingPayloadV2(
      v2.provider ?? "azure",
      enriched,
      parsed.textBasis,
    );

    if (v2MissingSpans(newPayload)) {
      skippedAlignment += 1;
      log.warn("speech.span_repair_incomplete", { articleId: row.articleId });
      continue;
    }

    if (opts.dryRun) {
      repaired += 1;
      continue;
    }

    try {
      await prisma.articleSpeech.update({
        where: { id: row.id },
        data: { words: newPayload },
      });
      repaired += 1;
    } catch {
      failed += 1;
      log.error("speech.span_repair_failed", {
        articleId: row.articleId,
        machineReason: "span_repair_persistence_failed",
      });
    }
  }

  return {
    scanned: rows.length,
    repaired,
    skippedHasSpans,
    skippedNoPlainText,
    skippedAlignment,
    failed,
  };
}
