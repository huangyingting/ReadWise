/**
 * Dictionary provider interface and dictionary adapters (REF-048).
 *
 * Defines a pluggable `DictionaryProvider` interface so concrete dictionary
 * backends are adapters rather than hard-coded in the service layer. Callers
 * (including tests) can supply any compatible implementation.
 *
 * Public types (`DictionaryDefinition`, `DictionaryMeaning`, `DictionaryResult`)
 * are the shared vocabulary for the entire lexical subsystem.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { createLogger } from "@/lib/observability/logger";
import { providerFetch } from "@/lib/http";
import {
  dictionaryProviderMode,
  localDictionaryDir,
  localDictionaryLanguage,
  type LocalDictionaryLanguage,
} from "@/lib/runtime-config/dictionary";
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

const LOCAL_DICTIONARY_FILES: Record<LocalDictionaryLanguage, string> = {
  en: "en-50k.json",
  cn: "cn-50k.json",
};

const localDictionaryCache = new Map<string, Map<string, DictionaryEntry>>();

type RawPhonetic = { text?: unknown; audio?: unknown };
type RawDefinition = { definition?: unknown; example?: unknown };
type RawMeaning = { partOfSpeech?: unknown; definitions?: unknown };
type RawEntry = {
  phonetic?: unknown;
  phonetics?: unknown;
  meanings?: unknown;
};

export type LocalDictionaryProviderOptions = {
  /** Directory containing compact `en-50k.json` / `cn-50k.json`. */
  directory?: string;
  /** Local dictionary file family to load. Defaults to runtime config. */
  dictionary?: LocalDictionaryLanguage;
};

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function toDefinitionStrings(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .flatMap((item) => toDefinitionStrings(item))
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, MAX_DEFINITIONS_PER_POS);
  }
  const text = nonEmptyString(value);
  return text ? [text] : [];
}

function localMeaningsFromCompact(value: unknown): DictionaryMeaning[] {
  if (!Array.isArray(value)) return [];

  const meanings: DictionaryMeaning[] = [];
  for (const item of value) {
    if (!Array.isArray(item) || item.length < 2) continue;
    const partOfSpeech = nonEmptyString(item[0]) ?? "definition";
    const definitions = toDefinitionStrings(item[1]).map((definition) => ({
      definition,
    }));
    if (definitions.length > 0) {
      meanings.push({ partOfSpeech, definitions });
    }
  }
  return meanings;
}

function buildLocalDictionaryEntry(value: unknown): DictionaryEntry | null {
  if (!Array.isArray(value)) return null;

  const [phoneticValue, meaningsValue] = value;
  const meanings = localMeaningsFromCompact(meaningsValue);

  if (meanings.length === 0) {
    return null;
  }

  return { phonetic: nonEmptyString(phoneticValue), meanings };
}

function normalizeLocalDictionaryData(data: unknown): Map<string, DictionaryEntry> {
  const dictionary = new Map<string, DictionaryEntry>();

  if (data && typeof data === "object") {
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      const entry = buildLocalDictionaryEntry(value);
      if (entry) {
        dictionary.set(key.toLowerCase(), entry);
      }
    }
  }

  return dictionary;
}

function loadLocalDictionary(filePath: string): Map<string, DictionaryEntry> {
  const cached = localDictionaryCache.get(filePath);
  if (cached) return cached;

  try {
    const raw = readFileSync(filePath, "utf-8");
    const dictionary = normalizeLocalDictionaryData(JSON.parse(raw) as unknown);
    localDictionaryCache.set(filePath, dictionary);
    log.info("lexical.local_dictionary_loaded", {
      dictionary: path.basename(filePath),
      entryCount: dictionary.size,
    });
    return dictionary;
  } catch (err) {
    const empty = new Map<string, DictionaryEntry>();
    localDictionaryCache.set(filePath, empty);
    log.warn("lexical.local_dictionary_load_failed", {
      dictionary: path.basename(filePath),
      error: String(err),
    });
    return empty;
  }
}

/**
 * Adapter for bundled local JSON dictionaries.
 *
 * Expected compact shape:
 * `{ "run": ["/rʌn/", [["verb", ["to move fast"]]]] }`.
 * Missing files, invalid JSON, and misses return `null` without throwing.
 */
export class LocalDictionaryProvider implements DictionaryProvider {
  private readonly directory: string;
  private readonly dictionary: LocalDictionaryLanguage;

  constructor(options: LocalDictionaryProviderOptions = {}) {
    this.directory = options.directory ?? localDictionaryDir();
    this.dictionary = options.dictionary ?? localDictionaryLanguage();
  }

  async fetchEntry(word: string): Promise<DictionaryEntry | null> {
    const key = word.trim().toLowerCase();
    if (!key) return null;
    const filePath = path.join(this.directory, LOCAL_DICTIONARY_FILES[this.dictionary]);
    const dictionary = loadLocalDictionary(filePath);
    return dictionary.get(key) ?? null;
  }
}

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

/** Try multiple providers in order, stopping at the first hit. */
export class FallbackDictionaryProvider implements DictionaryProvider {
  private readonly providers: DictionaryProvider[];

  constructor(providers: DictionaryProvider[]) {
    this.providers = providers;
  }

  async fetchEntry(word: string): Promise<DictionaryEntry | null> {
    for (const provider of this.providers) {
      const entry = await provider.fetchEntry(word);
      if (entry) return entry;
    }
    return null;
  }
}

/** Creates the default provider from runtime config. */
export function createDefaultDictionaryProvider(): DictionaryProvider {
  const mode = dictionaryProviderMode();
  if (mode === "local") {
    return new LocalDictionaryProvider();
  }
  if (mode === "hybrid") {
    return new FallbackDictionaryProvider([
      new LocalDictionaryProvider(),
      new FreeDictionaryProvider(),
    ]);
  }
  return new FreeDictionaryProvider();
}

/** Default provider instance (runtime-configured dictionary backend). */
export const defaultProvider: DictionaryProvider = createDefaultDictionaryProvider();
