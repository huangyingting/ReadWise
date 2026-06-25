/**
 * Cloze (fill-in-the-blank) review helpers — re-exported from the lexical
 * subsystem (REF-048, #38).
 *
 * This file is kept for backward compatibility. Prefer importing directly
 * from `@/lib/lexical/cloze` or `@/lib/lexical` in new code.
 */

export type { ClozeCard, ClozeResult } from "@/lib/lexical/cloze";
export { buildCloze, gradeCloze } from "@/lib/lexical/cloze";
