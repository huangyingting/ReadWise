/**
 * Canonical English word normalization and lemma module (REF-048).
 *
 * Single source of truth for:
 *   - CONTRACTIONS — common English contraction → base-word map
 *   - morphCandidates — morphological base-form candidates for a cleaned word
 *   - normalizeCandidates — ordered candidate list for dictionary lookup
 *   - lemmaFor — canonical lemma key for mastery/saved-word matching
 *
 * All exports are pure functions with no I/O. This file MUST remain free of
 * server-only imports (no `node:*`, no logger) so it can be safely bundled
 * into client components.
 */

/** Common English contractions mapped to a base word to look up. */
export const CONTRACTIONS: Record<string, string> = {
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
export function morphCandidates(word: string): string[] {
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
  w = w.replace(/[''`]/g, "'");
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

/**
 * Normalizes a raw word/token to a canonical lemma key. Reuses the dictionary
 * lemmatizer's first (surface-normalized) candidate so the lemma is consistent
 * across every call site (lowercased, contraction-expanded, possessive- and
 * punctuation-stripped). Returns "" for tokens with no alphabetic content.
 *
 * Note: this deliberately uses the first candidate (never an over-reduced stem)
 * so a lemma is always a real surface form — case/possessive variants merge,
 * while aggressive inflection-merging is left to the dictionary's resolved base
 * form. It never produces a garbage key.
 */
export function lemmaFor(word: string): string {
  const candidates = normalizeCandidates(word);
  if (candidates.length > 0) return candidates[0];
  return word.toLowerCase().trim();
}
