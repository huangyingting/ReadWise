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

/**
 * Common irregular inflections mapped to base-form lookup candidates.
 *
 * This list is intentionally conservative and exists to keep the local
 * dictionary small: pruned irregular forms such as "ran" can still resolve to
 * "run". It is also useful for unpruned forms because the lookup service tries
 * base forms before giving up.
 */
export const IRREGULAR_BASES: Record<string, string[]> = {
  // Auxiliary / core verb family
  am: ["be"],
  are: ["be"],
  is: ["be"],
  was: ["be"],
  were: ["be"],
  been: ["be"],
  did: ["do"],
  does: ["do"],
  done: ["do"],
  has: ["have"],
  had: ["have"],

  // Common irregular verbs
  ate: ["eat"],
  eaten: ["eat"],
  became: ["become"],
  began: ["begin"],
  begun: ["begin"],
  bit: ["bite"],
  bitten: ["bite"],
  blew: ["blow"],
  blown: ["blow"],
  bore: ["bear"],
  borne: ["bear"],
  bought: ["buy"],
  broke: ["break"],
  broken: ["break"],
  brought: ["bring"],
  built: ["build"],
  came: ["come"],
  caught: ["catch"],
  chose: ["choose"],
  chosen: ["choose"],
  clung: ["cling"],
  crept: ["creep"],
  drank: ["drink"],
  drawn: ["draw"],
  drew: ["draw"],
  driven: ["drive"],
  drove: ["drive"],
  drunk: ["drink"],
  dug: ["dig"],
  felt: ["feel"],
  flew: ["fly"],
  flown: ["fly"],
  forbade: ["forbid"],
  forbidden: ["forbid"],
  forgave: ["forgive"],
  forgiven: ["forgive"],
  fought: ["fight"],
  found: ["find"],
  froze: ["freeze"],
  frozen: ["freeze"],
  gave: ["give"],
  given: ["give"],
  gone: ["go"],
  grew: ["grow"],
  grown: ["grow"],
  held: ["hold"],
  hidden: ["hide"],
  hid: ["hide"],
  hung: ["hang"],
  kept: ["keep"],
  knew: ["know"],
  known: ["know"],
  laid: ["lay"],
  led: ["lead"],
  left: ["leave"],
  lent: ["lend"],
  lost: ["lose"],
  made: ["make"],
  meant: ["mean"],
  met: ["meet"],
  paid: ["pay"],
  ran: ["run"],
  ridden: ["ride"],
  rode: ["ride"],
  rose: ["rise"],
  risen: ["rise"],
  said: ["say"],
  sang: ["sing"],
  sank: ["sink"],
  sat: ["sit"],
  saw: ["see"],
  seen: ["see"],
  sent: ["send"],
  shaken: ["shake"],
  shook: ["shake"],
  shone: ["shine"],
  shot: ["shoot"],
  shown: ["show"],
  slept: ["sleep"],
  sold: ["sell"],
  sought: ["seek"],
  spent: ["spend"],
  spoke: ["speak"],
  spoken: ["speak"],
  spun: ["spin"],
  sprang: ["spring"],
  sprung: ["spring"],
  stood: ["stand"],
  stuck: ["stick"],
  struck: ["strike"],
  swam: ["swim"],
  swore: ["swear"],
  sworn: ["swear"],
  swum: ["swim"],
  swung: ["swing"],
  taken: ["take"],
  taught: ["teach"],
  thought: ["think"],
  threw: ["throw"],
  thrown: ["throw"],
  told: ["tell"],
  took: ["take"],
  tore: ["tear"],
  torn: ["tear"],
  understood: ["understand"],
  went: ["go"],
  woke: ["wake"],
  woken: ["wake"],
  won: ["win"],
  wore: ["wear"],
  worn: ["wear"],
  written: ["write"],
  wrote: ["write"],

  // Common irregular plurals
  alumnae: ["alumna"],
  alumni: ["alumnus"],
  analyses: ["analysis"],
  appendices: ["appendix"],
  bacteria: ["bacterium"],
  cacti: ["cactus"],
  children: ["child"],
  criteria: ["criterion"],
  crises: ["crisis"],
  curricula: ["curriculum"],
  diagnoses: ["diagnosis"],
  feet: ["foot"],
  fungi: ["fungus"],
  geese: ["goose"],
  indices: ["index"],
  lice: ["louse"],
  matrices: ["matrix"],
  media: ["medium"],
  men: ["man"],
  mice: ["mouse"],
  nuclei: ["nucleus"],
  oases: ["oasis"],
  oxen: ["ox"],
  people: ["person"],
  phenomena: ["phenomenon"],
  syllabi: ["syllabus"],
  teeth: ["tooth"],
  theses: ["thesis"],
  vertices: ["vertex"],
  vortices: ["vortex"],
  women: ["woman"],
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
  if (word.endsWith("ves") && word.length > 4) {
    add(word.slice(0, -3) + "f");
    add(word.slice(0, -3) + "fe");
  }
  if (word.endsWith("es") && word.length > 3) {
    const removeEs = word.slice(0, -2);
    const removeS = word.slice(0, -1);
    if (/(ches|shes|sses|xes|zes|oes)$/.test(word)) {
      add(removeEs);
      add(removeS);
    } else {
      add(removeS);
      add(removeEs);
    }
  }
  if (word.endsWith("s") && !word.endsWith("ss") && word.length > 2) {
    add(word.slice(0, -1));
  }

  if (word.endsWith("ing") && word.length > 4) {
    const stem = word.slice(0, -3);
    if (word.endsWith("ying") && word.length > 5) {
      add(word.slice(0, -4) + "ie");
    }
    if (/(.)\1$/.test(stem)) {
      add(stem.slice(0, -1));
    }
    add(stem + "e");
    add(stem);
  }

  if (word.endsWith("ied") && word.length > 4) {
    add(word.slice(0, -3) + "y");
  }
  if (word.endsWith("ed") && word.length > 3) {
    const stem = word.slice(0, -2);
    if (/(.)\1$/.test(stem)) {
      add(stem.slice(0, -1));
    }
    add(word.slice(0, -1));
    add(stem);
  }

  if (word.endsWith("er") && word.length > 4) {
    const stem = word.slice(0, -2);
    if (/(.)\1$/.test(stem)) {
      add(stem.slice(0, -1));
    }
    add(stem);
    add(word.slice(0, -1));
  }
  if (word.endsWith("est") && word.length > 5) {
    const stem = word.slice(0, -3);
    if (/(.)\1$/.test(stem)) {
      add(stem.slice(0, -1));
    }
    add(stem);
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
    const contractionBase = CONTRACTIONS[w];
    add(contractionBase);
    for (const candidate of IRREGULAR_BASES[contractionBase] ?? []) {
      add(candidate);
    }
  }

  // Possessives: dog's -> dog ; dogs' -> dogs
  if (w.endsWith("'s")) {
    w = w.slice(0, -2);
  } else if (w.endsWith("'")) {
    w = w.slice(0, -1);
  }

  const base = w.replace(/'/g, "");
  const morphs = morphCandidates(base);
  for (const [index, candidate] of morphs.entries()) {
    add(candidate);
    if (index === 0) {
      for (const irregular of IRREGULAR_BASES[base] ?? []) {
        add(irregular);
      }
    }
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
