/**
 * Dictionary provider interface and Free Dictionary API adapter (REF-048).
 *
 * Defines a pluggable `DictionaryProvider` interface so the Free Dictionary
 * API is one concrete adapter rather than hard-coded in the service layer.
 * Callers (including tests) can supply any compatible implementation.
 *
 * Public types (`DictionaryDefinition`, `DictionaryMeaning`, `DictionaryResult`)
 * are the shared vocabulary for the entire lexical subsystem.
 */

import { createLogger } from "@/lib/logger";
import { providerFetch } from "@/lib/http";
import type { FrequencyTier } from "@/lib/option-registries";

const log = createLogger("lexical.provider");

// ---------------------------------------------------------------------------
// Shared result types
// ---------------------------------------------------------------------------

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
  /** Pre-computed frequency tier (server-resolved); null when not in the list. */
  frequencyTier?: FrequencyTier | null;
};

// ---------------------------------------------------------------------------
// Provider interface
// ---------------------------------------------------------------------------

/**
 * Internal entry returned by a provider for a single word form.
 * The `word` and `lookedUp` fields are added by the lookup service.
 */
export type DictionaryEntry = {
  phonetic?: string;
  audio?: string;
  meanings: DictionaryMeaning[];
};

/**
 * Pluggable dictionary provider interface.
 *
 * Implementations must return `null` on any failure or "not found" condition
 * rather than throwing, so the lookup service can try the next candidate
 * gracefully.
 */
export interface DictionaryProvider {
  /** Fetches a parsed entry for a single word form, or null when not found. */
  fetchEntry(word: string): Promise<DictionaryEntry | null>;
}

// ---------------------------------------------------------------------------
// Free Dictionary API implementation
// ---------------------------------------------------------------------------

const FREE_DICTIONARY_ENDPOINT = "https://api.dictionaryapi.dev/api/v2/entries/en/";

/** Max definitions kept per part of speech (keeps the popover compact). */
const MAX_DEFINITIONS_PER_POS = 4;

type RawPhonetic = { text?: unknown; audio?: unknown };
type RawDefinition = { definition?: unknown; example?: unknown };
type RawMeaning = { partOfSpeech?: unknown; definitions?: unknown };
type RawEntry = {
  phonetic?: unknown;
  phonetics?: unknown;
  meanings?: unknown;
};

/**
 * Adapter for the Free Dictionary API (https://dictionaryapi.dev/).
 *
 * Network failures and non-200 responses degrade gracefully to `null`.
 * Only low-cardinality provider/status metadata is logged — never the
 * word text or definitions.
 */
export class FreeDictionaryProvider implements DictionaryProvider {
  async fetchEntry(word: string): Promise<DictionaryEntry | null> {
    let data: unknown;
    try {
      const res = await providerFetch(
        `${FREE_DICTIONARY_ENDPOINT}${encodeURIComponent(word)}`,
        {},
        { timeoutMs: 8000, provider: "dictionary" },
      );
      if (!res.ok) {
        return null;
      }
      data = await res.json();
    } catch (err) {
      log.warn("lexical.provider.fetch_error", { error: String(err) });
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
}

/** Default provider instance (Free Dictionary API). */
export const defaultProvider: DictionaryProvider = new FreeDictionaryProvider();
