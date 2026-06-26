/**
 * CSV formatting helpers — RFC 4180 compliant.
 *
 * The only public export is {@link csvField}, which correctly handles all
 * characters that require quoting: `"`, `,`, `\n` (LF), and `\r` (CR).
 * Use {@link csvRow} to join fields and {@link csvRows} to build a full CSV
 * body with `\r\n` line endings as required by RFC 4180.
 */

/**
 * Escapes a single value for RFC-4180 CSV.
 *
 * Wraps the value in double-quotes when it contains a double-quote, comma,
 * carriage-return (`\r`), or newline (`\n`). Inner double-quotes are doubled.
 */
export function csvField(value: string | number | null | undefined): string {
  const s = value === null || value === undefined ? "" : String(value);
  if (s.includes('"') || s.includes(",") || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** Joins fields into a single CSV row (no line terminator). */
export function csvRow(fields: (string | number | null | undefined)[]): string {
  return fields.map(csvField).join(",");
}

/**
 * Converts a 2-D array of values into a complete CSV document.
 * Lines are terminated with `\r\n` per RFC 4180.
 */
export function csvRows(rows: (string | number | null | undefined)[][]): string {
  return rows.map(csvRow).join("\r\n");
}
