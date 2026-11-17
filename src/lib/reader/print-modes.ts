/**
 * Client-safe printable-packet modes (#1306), shared by the print page, its
 * toolbar, and the server loader in `./print`.
 */

export const PRINT_MODES = ["article", "worksheet", "answer-key", "fluency"] as const;
export type PrintMode = (typeof PRINT_MODES)[number];

export const PRINT_MODE_LABELS: Record<PrintMode, string> = {
  article: "Article only",
  worksheet: "Article + vocabulary & quiz",
  "answer-key": "Article + quiz + answer key",
  fluency: "Oral fluency passage + rubric",
};

/** Modes only educators may print (answer key; fluency scoring sheet, #1304). */
export const EDUCATOR_PRINT_MODES: readonly PrintMode[] = ["answer-key", "fluency"];

/** Parses `?mode=`; anything unknown prints the article only. */
export function parsePrintMode(value: string | string[] | undefined): PrintMode {
  const mode = Array.isArray(value) ? value[0] : value;
  return (PRINT_MODES as readonly string[]).includes(mode ?? "") ? (mode as PrintMode) : "article";
}

/** "A", "B", … for a zero-based option index. */
export function optionLetter(index: number): string {
  return String.fromCharCode(65 + index);
}
