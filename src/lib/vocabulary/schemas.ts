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

// ---------------------------------------------------------------------------
// POST /api/vocabulary/save
// ---------------------------------------------------------------------------

export const saveWordBody = object({
  word: nonEmptyString(200),
  explanation: optional(string({ trim: false, max: 5000 })),
  example: optional(string({ trim: false, max: 5000 })),
  contextSentence: optional(string({ trim: false, max: 2000 })),
  articleId: optional(nonEmptyString(200)),
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
  words: array(nonEmptyString(200), { max: 200 }),
});

export type UnsaveBatchBody = InferSchema<typeof unsaveBatchBody>;

// ---------------------------------------------------------------------------
// GET /api/vocabulary/export
// ---------------------------------------------------------------------------

export type ExportFormat = "csv" | "anki";
export type ExportQuery = { format: ExportFormat };

export function parseExportQuery(
  params: URLSearchParams,
): ValidationResult<ExportQuery> {
  const format = queryString(params, "format", "csv");
  if (format !== "csv" && format !== "anki") {
    return { ok: false, error: 'format must be "csv" or "anki"' };
  }
  return { ok: true, value: { format: format as ExportFormat } };
}
