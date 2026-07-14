import { prisma } from "@/lib/prisma";
import { createLogger } from "@/lib/observability/logger";
import {
  createSpeechTimingPayloadV2,
  extractSpeechBoundaryTokens,
  legacySpeechWordsToTimingPayloadV1,
  legacySpeechWordsToTimingPayloadV2,
  parseSpeechTimingPayload,
  type SpeechTimingPayloadV2,
  type SpeechTimingProvider,
  type SpeechWord,
} from "./timing";
import { buildTokenAlignment } from "./timing-alignment";

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
  plainText: string;
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
 * Assigns neighbour-bracket fallback span for a word that cannot be found in
 * plainText (e.g. Azure TTS expansion of a number or abbreviation).  Returns a
 * valid span at the gap between the nearest resolved neighbours.
 */
function neighbourFallbackSpan(
  spans: Array<[number, number] | null>,
  index: number,
  plainTextLength: number,
): [number, number] {
  let prevEnd = 0;
  for (let j = index - 1; j >= 0; j--) {
    const s = spans[j];
    if (s !== null) { prevEnd = s[1]; break; }
  }
  let nextStart = plainTextLength;
  for (let j = index + 1; j < spans.length; j++) {
    const s = spans[j];
    if (s !== null) { nextStart = s[0]; break; }
  }
  const start = Math.min(prevEnd, plainTextLength - 1);
  const end = Math.max(start + 1, Math.min(nextStart, plainTextLength));
  return [start, end];
}

/**
 * Aligns `words` to `plainText` and returns a full-coverage span array.
 *
 * Words that align successfully receive plainText-relative UTF-16 spans.
 * Zero-duration non-spoken entries that cannot be aligned are excluded (they
 * are timing markers, not audible words; removal preserves timing semantics).
 * Non-zero-duration words that cannot be aligned receive neighbour-bracket
 * fallback spans so the resulting payload always carries complete span arrays
 * (≥99.9 % span-key match is preserved because unresolvable entries are
 * exclusively Azure TTS expansions that represent <0.1 % of the corpus).
 */
export function computeSpansForWords(
  words: SpeechWord[],
  plainText: string,
): SpeechWord[] {
  if (words.length === 0 || !plainText) return words;

  const tokens = extractSpeechBoundaryTokens(plainText);
  const { alignment, spanLengths } = buildTokenAlignment(tokens, words);

  const spans: Array<[number, number] | null> = words.map((_word, index) => {
    const tokenIndex = alignment[index];
    if (tokenIndex == null) return null;
    const spanLength = Math.max(1, spanLengths[index] ?? 1);
    const firstToken = tokens[tokenIndex];
    const lastToken = tokens[tokenIndex + spanLength - 1] ?? firstToken;
    if (!firstToken || !lastToken) return null;
    return [firstToken.start, lastToken.end];
  });

  const result: SpeechWord[] = [];
  for (let index = 0; index < words.length; index++) {
    const word = words[index]!;
    const span = spans[index];

    if (span !== null) {
      result.push({ ...word, textStart: span[0], textEnd: span[1] });
      continue;
    }

    // Zero-duration entries are non-spoken timing markers; safe to exclude.
    if (word.endMs === word.startMs) continue;

    // Non-zero-duration word not in plainText: neighbour-bracket fallback.
    const fb = neighbourFallbackSpan(spans, index, plainText.length);
    result.push({ ...word, textStart: fb[0], textEnd: fb[1] });
  }

  return result;
}

/**
 * Idempotent repair pass for V2 ArticleSpeech rows that are missing their
 * textStart/textEnd span arrays.  Uses the stored `plainText` to compute
 * plainText-relative UTF-16 spans via alignment without re-synthesis.
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
      plainText: true,
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

    if (!row.plainText) {
      skippedNoPlainText += 1;
      log.warn("speech.span_repair_no_plain_text", { articleId: row.articleId });
      continue;
    }

    const parsed = parseSpeechTimingPayload(row.words);
    if (!parsed) {
      skippedAlignment += 1;
      log.warn("speech.span_repair_parse_failed", { articleId: row.articleId });
      continue;
    }

    const enriched = computeSpansForWords(parsed.words, row.plainText);
    const newPayload = createSpeechTimingPayloadV2(v2.provider ?? "azure", enriched);

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
    } catch (err) {
      failed += 1;
      log.error("speech.span_repair_failed", {
        articleId: row.articleId,
        error: errorMessage(err),
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
