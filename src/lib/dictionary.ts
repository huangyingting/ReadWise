/**
 * Dictionary lookup with lightweight English lemmatization.
 *
 * Word forms (plurals, gerunds, past tenses, comparatives, contractions and
 * possessives) are normalized to an ordered list of candidate base forms; the
 * first form that resolves against the Free Dictionary API wins. Following the
 * project's graceful-fallback convention, network/lookup failures degrade to a
 * clear "not found" result instead of throwing.
 */

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

/** Common English contractions mapped to a base word to look up. */
const CONTRACTIONS: Record<string, string> = {
  "i'm": "i",
  "you're": "you",
  "he's": "he",
  "she's": "she",
  "it's": "it",
  "we're": "we",
  "they're": "they",
  "i've": "i",
  "you've": "you",
  "we've": "we",
  "they've": "they",
  "i'll": "i",
  "you'll": "you",
  "he'll": "he",
  "she'll": "she",
  "it'll": "it",
  "we'll": "we",
  "they'll": "they",
  "i'd": "i",
  "you'd": "you",
  "he'd": "he",
  "she'd": "she",
  "we'd": "we",
  "they'd": "they",
  "isn't": "is",
  "aren't": "are",
  "wasn't": "was",
  "weren't": "were",
  "don't": "do",
  "doesn't": "does",
  "didn't": "did",
  "can't": "can",
  cannot: "can",
  "couldn't": "could",
  "won't": "will",
  "wouldn't": "would",
  "shouldn't": "should",
  "mustn't": "must",
  "mightn't": "might",
  "hasn't": "has",
  "haven't": "have",
  "hadn't": "had",
  "let's": "let",
  "that's": "that",
  "there's": "there",
  "what's": "what",
  "who's": "who",
  "where's": "where",
  "here's": "here",
};

/** Generates morphological base-form candidates for an already-cleaned word. */
function morphCandidates(word: string): string[] {
  const out: string[] = [];
  const add = (w: string) => {
    if (w && w.length >= 1 && !out.includes(w)) {
      out.push(w);
    }
  };

  add(word);

  if (word.endsWith("ies") && word.length > 4) {
    add(word.slice(0, -3) + "y");
  }
  if (word.endsWith("es") && word.length > 3) {
    add(word.slice(0, -2));
    add(word.slice(0, -1));
  }
  if (word.endsWith("s") && !word.endsWith("ss") && word.length > 2) {
    add(word.slice(0, -1));
  }

  if (word.endsWith("ing") && word.length > 4) {
    const stem = word.slice(0, -3);
    add(stem);
    add(stem + "e");
    if (/(.)\1$/.test(stem)) {
      add(stem.slice(0, -1));
    }
  }

  if (word.endsWith("ied") && word.length > 4) {
    add(word.slice(0, -3) + "y");
  }
  if (word.endsWith("ed") && word.length > 3) {
    const stem = word.slice(0, -2);
    add(stem);
    add(word.slice(0, -1));
    if (/(.)\1$/.test(stem)) {
      add(stem.slice(0, -1));
    }
  }

  if (word.endsWith("er") && word.length > 4) {
    add(word.slice(0, -2));
    add(word.slice(0, -1));
  }
  if (word.endsWith("est") && word.length > 5) {
    add(word.slice(0, -3));
    add(word.slice(0, -2));
  }
  if (word.endsWith("ly") && word.length > 4) {
    add(word.slice(0, -2));
  }

  return out;
}

/**
 * Normalizes a raw selected token into an ordered list of base-form candidates
 * to try, handling contractions, possessives and common inflections.
 */
export function normalizeCandidates(raw: string): string[] {
  let w = raw.toLowerCase().trim();
  w = w.replace(/[’‘`]/g, "'");
  // Strip leading/trailing characters that are neither letters nor apostrophes.
  w = w.replace(/^[^a-z']+|[^a-z']+$/g, "");
  if (!w) {
    return [];
  }

  const out: string[] = [];
  const add = (x: string) => {
    if (x && !out.includes(x)) {
      out.push(x);
    }
  };

  if (CONTRACTIONS[w]) {
    add(CONTRACTIONS[w]);
  }

  // Possessives: dog's -> dog ; dogs' -> dogs
  if (w.endsWith("'s")) {
    w = w.slice(0, -2);
  } else if (w.endsWith("'")) {
    w = w.slice(0, -1);
  }

  const base = w.replace(/'/g, "");
  for (const candidate of morphCandidates(base)) {
    add(candidate);
  }

  return out;
}

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
    const res = await fetch(
      `${DICTIONARY_ENDPOINT}${encodeURIComponent(word)}`,
      { signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok) {
      return null;
    }
    data = await res.json();
  } catch {
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

  if (candidates.length === 0) {
    return { word: display, found: false, meanings: [] };
  }

  for (const candidate of candidates) {
    const entry = await fetchEntry(candidate);
    if (entry) {
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

  return { word: display, found: false, meanings: [] };
}
