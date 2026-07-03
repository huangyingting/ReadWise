/**
 * CSV formatting helpers — RFC 4180 compliant.
 *
 * Public exports correctly handle all characters that require quoting: `"`,
 * `,`, `\n` (LF), and `\r` (CR). Use {@link csvRow} to join fields and
 * {@link csvRows} to build a full CSV body with `\r\n` line endings as
 * required by RFC 4180.
 */

type CsvValue = string | number | null | undefined;

const CSV_FIELD_SEPARATOR = ",";
const CSV_ROW_SEPARATOR = "\r\n";
const QUOTE_RE = /"/g;
const NEEDS_QUOTING_RE = /[",\n\r]/;

function csvValueToString(value: CsvValue): string {
  return value === null || value === undefined ? "" : String(value);
}

function quoteCsvField(value: string): string {
  return `"${value.replace(QUOTE_RE, '""')}"`;
}

/**
 * Escapes a single value for RFC-4180 CSV.
 *
 * Wraps the value in double-quotes when it contains a double-quote, comma,
 * carriage-return (`\r`), or newline (`\n`). Inner double-quotes are doubled.
 */
export function csvField(value: CsvValue): string {
  const field = csvValueToString(value);
  return NEEDS_QUOTING_RE.test(field) ? quoteCsvField(field) : field;
}

/** Joins fields into a single CSV row (no line terminator). */
export function csvRow(fields: CsvValue[]): string {
  return fields.map(csvField).join(CSV_FIELD_SEPARATOR);
}

/**
 * Converts a 2-D array of values into a complete CSV document.
 * Lines are terminated with `\r\n` per RFC 4180.
 */
export function csvRows(rows: CsvValue[][]): string {
  return rows.map(csvRow).join(CSV_ROW_SEPARATOR);
}
