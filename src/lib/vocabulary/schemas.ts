/**
 * Feature-owned schema module for vocabulary routes (REF-043).
 * Exports body schemas, query parsers, and inferred TypeScript types so both
 * route handlers and tests can import the contracts directly.
 */

import {
  object,
  nonEmptyString,
  optional,
  string,
  array,
  queryString,
  type Schema,
  type ValidationResult,
} from "@/lib/validation";

/** Helper: extract the validated value type from any Schema<T>. */
type InferSchema<S extends Schema<unknown>> = S extends Schema<infer T> ? T : never;

const WORD_MAX_LENGTH = 200;
const TEXT_MAX_LENGTH = 5000;
const CONTEXT_SENTENCE_MAX_LENGTH = 2000;
const BATCH_WORD_LIMIT = 200;

// ---------------------------------------------------------------------------
// POST /api/vocabulary/save
// ---------------------------------------------------------------------------

export const saveWordBody = object({
  word: nonEmptyString(WORD_MAX_LENGTH),
  explanation: optional(string({ trim: false, max: TEXT_MAX_LENGTH })),
  example: optional(string({ trim: false, max: TEXT_MAX_LENGTH })),
  contextSentence: optional(string({ trim: false, max: CONTEXT_SENTENCE_MAX_LENGTH })),
  articleId: optional(nonEmptyString(WORD_MAX_LENGTH)),
});

export type SaveWordBody = InferSchema<typeof saveWordBody>;

// ---------------------------------------------------------------------------
// POST /api/vocabulary/unsave
// ---------------------------------------------------------------------------

export const unsaveWordBody = object({ word: nonEmptyString(200) });

export type UnsaveWordBody = InferSchema<typeof unsaveWordBody>;

// ---------------------------------------------------------------------------
// POST /api/vocabulary/unsave-batch
// ---------------------------------------------------------------------------

export const unsaveBatchBody = object({
  words: array(nonEmptyString(WORD_MAX_LENGTH), { max: BATCH_WORD_LIMIT }),
});

export type UnsaveBatchBody = InferSchema<typeof unsaveBatchBody>;

// ---------------------------------------------------------------------------
// POST /api/vocabulary/erase-context
// ---------------------------------------------------------------------------

export const eraseSavedWordContextBody = object({ word: nonEmptyString(WORD_MAX_LENGTH) });

export type EraseSavedWordContextBody = InferSchema<typeof eraseSavedWordContextBody>;

// ---------------------------------------------------------------------------
// GET /api/vocabulary/export
// ---------------------------------------------------------------------------

export type ExportFormat = "csv" | "anki";
export type ExportQuery = { format: ExportFormat };

const EXPORT_FORMATS: readonly ExportFormat[] = ["csv", "anki"];

function isExportFormat(format: string): format is ExportFormat {
  return EXPORT_FORMATS.includes(format as ExportFormat);
}

export function parseExportQuery(
  params: URLSearchParams,
): ValidationResult<ExportQuery> {
  const format = queryString(params, "format", "csv");
  if (!isExportFormat(format)) {
    return { ok: false, error: 'format must be "csv" or "anki"' };
  }
  return { ok: true, value: { format } };
}
