/**
 * Pure English lemmatization helpers — re-exported from the canonical
 * lexical normalization module (REF-048).
 *
 * This file is kept for backward compatibility. Prefer importing directly
 * from `@/lib/lexical/normalize` in new code.
 *
 * This file MUST remain free of server-only imports (no `node:*`, no logger)
 * so it can be safely bundled into client components.
 */

export {
  CONTRACTIONS,
  morphCandidates,
  normalizeCandidates,
} from "@/lib/lexical/normalize";
