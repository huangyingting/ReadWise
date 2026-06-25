/**
 * Dictionary lookup with lightweight English lemmatization.
 *
 * Word forms (plurals, gerunds, past tenses, comparatives, contractions and
 * possessives) are normalized to an ordered list of candidate base forms; the
 * first form that resolves against the Free Dictionary API wins. Following the
 * project's graceful-fallback convention, network/lookup failures degrade to a
 * clear "not found" result instead of throwing.
 */

import { createLogger } from "@/lib/logger";
import { normalizeCandidates } from "@/lib/dictionary-normalize";
import { providerFetch } from "@/lib/http/provider-client";

const log = createLogger("dictionary");

export type DictionaryDefinition = {
  definition: string;
  example?: string;
};

export type DictionaryMeaning = {
  partOfSpeech: string;
  definitions: DictionaryDefinition[];
};

export type DictionaryResult = {
  /** The original term the user looked up (for display). */
  word: string;
  /** The normalized base form that produced a match, when found. */
  lookedUp?: string;
  found: boolean;
  phonetic?: string;
  audio?: string;
  meanings: DictionaryMeaning[];
};

const DICTIONARY_ENDPOINT =
  "https://api.dictionaryapi.dev/api/v2/entries/en/";

/** Max definitions kept per part of speech (keeps the popover compact). */
const MAX_DEFINITIONS_PER_POS = 4;

// Re-export so existing imports of normalizeCandidates from this module continue to work.
export { normalizeCandidates };

type RawPhonetic = { text?: unknown; audio?: unknown };
type RawDefinition = { definition?: unknown; example?: unknown };
type RawMeaning = { partOfSpeech?: unknown; definitions?: unknown };
type RawEntry = {
  phonetic?: unknown;
  phonetics?: unknown;
  meanings?: unknown;
};

type Entry = Pick<DictionaryResult, "phonetic" | "audio" | "meanings">;

/** Fetches and parses a single dictionary entry, or null when not found. */
async function fetchEntry(word: string): Promise<Entry | null> {
  let data: unknown;
  try {
    const res = await providerFetch(
      `${DICTIONARY_ENDPOINT}${encodeURIComponent(word)}`,
      {},
      { timeoutMs: 8000, provider: "dictionary" },
    );
    if (!res.ok) {
      return null;
    }
    data = await res.json();
  } catch (err) {
    log.warn("dictionary.fetch_error", { word, error: String(err) });
    return null;
  }

  if (!Array.isArray(data) || data.length === 0) {
    return null;
  }

  let phonetic: string | undefined;
  let audio: string | undefined;
  const grouped = new Map<string, DictionaryDefinition[]>();

  for (const raw of data as RawEntry[]) {
    if (!phonetic && typeof raw.phonetic === "string" && raw.phonetic.trim()) {
      phonetic = raw.phonetic.trim();
    }
    if (Array.isArray(raw.phonetics)) {
      for (const p of raw.phonetics as RawPhonetic[]) {
        if (!phonetic && typeof p.text === "string" && p.text.trim()) {
          phonetic = p.text.trim();
        }
        if (!audio && typeof p.audio === "string" && p.audio.trim()) {
          audio = p.audio.trim();
        }
      }
    }
    if (Array.isArray(raw.meanings)) {
      for (const m of raw.meanings as RawMeaning[]) {
        const pos =
          typeof m.partOfSpeech === "string" && m.partOfSpeech.trim()
            ? m.partOfSpeech.trim()
            : "other";
        const defs = grouped.get(pos) ?? [];
        if (Array.isArray(m.definitions)) {
          for (const d of m.definitions as RawDefinition[]) {
            if (
              typeof d.definition === "string" &&
              d.definition.trim() &&
              defs.length < MAX_DEFINITIONS_PER_POS
            ) {
              defs.push({
                definition: d.definition.trim(),
                example:
                  typeof d.example === "string" && d.example.trim()
                    ? d.example.trim()
                    : undefined,
              });
            }
          }
        }
        if (defs.length > 0) {
          grouped.set(pos, defs);
        }
      }
    }
  }

  const meanings: DictionaryMeaning[] = [...grouped.entries()].map(
    ([partOfSpeech, definitions]) => ({ partOfSpeech, definitions }),
  );

  if (meanings.length === 0) {
    return null;
  }

  return { phonetic, audio, meanings };
}

/**
 * Looks up a word, trying each normalized base-form candidate until one
 * resolves. Returns a `found: false` result (never throws) when nothing
 * matches or the dictionary provider is unreachable.
 */
export async function lookupWord(raw: string): Promise<DictionaryResult> {
  const display = raw.trim();
  const candidates = normalizeCandidates(raw);
  const start = Date.now();

  log.info("dictionary.lookup_start", { word: display });

  if (candidates.length === 0) {
    log.info("dictionary.lookup_outcome", {
      word: display,
      found: false,
      reason: "no_candidates",
      durationMs: Date.now() - start,
    });
    return { word: display, found: false, meanings: [] };
  }

  for (const candidate of candidates) {
    const entry = await fetchEntry(candidate);
    if (entry) {
      log.info("dictionary.lookup_outcome", {
        word: display,
        lookedUp: candidate,
        found: true,
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

  log.info("dictionary.lookup_outcome", {
    word: display,
    found: false,
    candidatesTried: candidates.length,
    durationMs: Date.now() - start,
  });
  return { word: display, found: false, meanings: [] };
}
