/**
 * Dictionary lookup service (REF-048).
 *
 * Resolves a raw word through an ordered list of normalized base-form
 * candidates, trying each against the configured provider until one matches.
 * Returns a `found: false` result (never throws) when nothing resolves or the
 * provider is unreachable.
 */

import { createLogger } from "@/lib/observability/logger";
import { normalizeCandidates } from "@/lib/lexical/normalize";
import {
  defaultProvider,
  type DictionaryProvider,
  type DictionaryResult,
} from "@/lib/lexical/provider";

const log = createLogger("lexical.lookup");

/**
 * Looks up a word, trying each normalized base-form candidate until one
 * resolves. Returns a `found: false` result (never throws) when nothing
 * matches or the dictionary provider is unreachable.
 *
 * An optional `provider` can be supplied for testing or alternative backends;
 * defaults to the Free Dictionary API provider.
 */
export async function lookupWord(
  raw: string,
  provider: DictionaryProvider = defaultProvider,
): Promise<DictionaryResult> {
  const display = raw.trim();
  const candidates = normalizeCandidates(raw);
  const start = Date.now();

  log.info("lexical.lookup_start", { candidateCount: candidates.length });

  if (candidates.length === 0) {
    log.info("lexical.lookup_outcome", {
      found: false,
      reason: "no_candidates",
      durationMs: Date.now() - start,
    });
    return { word: display, found: false, meanings: [] };
  }

  for (const candidate of candidates) {
    const entry = await provider.fetchEntry(candidate);
    if (entry) {
      log.info("lexical.lookup_outcome", {
        found: true,
        candidatesTried: candidates.indexOf(candidate) + 1,
        durationMs: Date.now() - start,
      });
      return {
        word: display,
        lookedUp: candidate,
        found: true,
        phonetic: entry.phonetic,
        audio: entry.audio,
        meanings: entry.meanings,
      };
    }
  }

  log.info("lexical.lookup_outcome", {
    found: false,
    candidatesTried: candidates.length,
    durationMs: Date.now() - start,
  });
  return { word: display, found: false, meanings: [] };
}
