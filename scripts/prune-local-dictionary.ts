/**
 * Prune bundled local dictionary files.
 *
 * The goal is to remove entries that are clearly just inflected forms already
 * covered by lexical normalization (e.g. past tense, third-person singular,
 * plural-form entries), while preserving lexicalized words such as "building",
 * "news", "left", or "shot". The script expects and writes compact minified
 * JSON: `{ word: [phonetic, [[partOfSpeech, definitions]]] }`.
 *
 * Usage:
 *   npm run dict:prune -- --dry-run
 *   npm run dict:prune
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { normalizeCandidates } from "@/lib/lexical/normalize";

type CompactMeaning = [partOfSpeech: string, definitions: string[]];
type CompactEntry = [phonetic: string, meanings: CompactMeaning[]];
type DictionaryJson = Record<string, CompactEntry>;

const DICTIONARY_DIR = path.resolve(process.cwd(), "dict");
const DICTIONARY_FILES = ["en-50k.json", "cn-50k.json"];
const WORD_LIST_FILE = "50k.txt";

/**
 * Cues that the entry is explicitly describing an inflected form rather than a
 * base lemma. We require both a cue and an existing base candidate before
 * pruning, which keeps the cleanup conservative.
 */
const INFLECTION_CUE_RE =
  /\b(third[- ]person|past tense|past participle|present participle|simple past|plural of|plural form of|comparative(?: form)? of|superlative(?: form)? of|gerund of|inflection of|conjugation of)\b/i;

/** Common independent lemmas that also look like inflections in some contexts. */
const LEXICALIZED_KEEP = new Set(["saw"]);

/**
 * Known irregular inflections that should be pruned even when the generated
 * definition does not explicitly say "plural of" / "past tense of".
 * Ambiguous lexicalized words such as `people`, `left`, `found`, `shot`, and
 * `wound` are deliberately excluded.
 */
const EXPLICIT_INFLECTION_BASES = new Map<string, string>([
  ["am", "be"],
  ["are", "be"],
  ["is", "be"],
  ["was", "be"],
  ["were", "be"],
  ["been", "be"],
  ["did", "do"],
  ["does", "do"],
  ["done", "do"],
  ["has", "have"],
  ["had", "have"],
  ["alumnae", "alumna"],
  ["alumni", "alumnus"],
  ["analyses", "analysis"],
  ["appendices", "appendix"],
  ["bacteria", "bacterium"],
  ["cacti", "cactus"],
  ["children", "child"],
  ["criteria", "criterion"],
  ["crises", "crisis"],
  ["curricula", "curriculum"],
  ["diagnoses", "diagnosis"],
  ["feet", "foot"],
  ["fungi", "fungus"],
  ["geese", "goose"],
  ["indices", "index"],
  ["lice", "louse"],
  ["matrices", "matrix"],
  ["men", "man"],
  ["mice", "mouse"],
  ["nuclei", "nucleus"],
  ["oases", "oasis"],
  ["oxen", "ox"],
  ["phenomena", "phenomenon"],
  ["syllabi", "syllabus"],
  ["teeth", "tooth"],
  ["theses", "thesis"],
  ["vertices", "vertex"],
  ["vortices", "vortex"],
  ["women", "woman"],
]);

function flattenText(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(flattenText).join("\n");
  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>).map(flattenText).join("\n");
  }
  return String(value);
}

function extractQuotedBases(text: string): string[] {
  const out: string[] = [];
  const re = /\b(?:of|from)\s+["'“‘]([a-z][a-z'-]{1,})["'”’]/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const candidate = match[1]?.toLowerCase();
    if (candidate && !out.includes(candidate)) {
      out.push(candidate);
    }
  }
  return out;
}

function baseCandidates(word: string, text: string, keys: Set<string>): string[] {
  const out: string[] = [];
  const add = (candidate: string) => {
    const normalized = candidate.toLowerCase().trim();
    if (normalized && normalized !== word && keys.has(normalized) && !out.includes(normalized)) {
      out.push(normalized);
    }
  };

  for (const candidate of extractQuotedBases(text)) {
    add(candidate);
  }
  for (const candidate of normalizeCandidates(word)) {
    add(candidate);
  }

  return out;
}

function pruneDictionary(
  dictionary: DictionaryJson,
  sharedRemovals: Map<string, string> = new Map(),
): { pruned: DictionaryJson; removed: Array<{ word: string; base: string; cue: string }> } {
  const keys = new Set(Object.keys(dictionary).map((key) => key.toLowerCase()));
  const pruned: DictionaryJson = {};
  const removed: Array<{ word: string; base: string; cue: string }> = [];

  for (const [word, entry] of Object.entries(dictionary)) {
    const key = word.toLowerCase();
    const text = flattenText(entry);
    const cue = text.match(INFLECTION_CUE_RE)?.[0];
    const bases = cue ? baseCandidates(key, text, keys) : [];
    const explicitBase = EXPLICIT_INFLECTION_BASES.get(key);
    const sharedBase = sharedRemovals.get(key);

    if (cue && bases.length > 0 && !LEXICALIZED_KEEP.has(key)) {
      removed.push({ word, base: bases[0], cue });
      continue;
    }
    if (explicitBase && keys.has(explicitBase) && !LEXICALIZED_KEEP.has(key)) {
      removed.push({ word, base: explicitBase, cue: "known irregular inflection" });
      continue;
    }
    if (sharedBase && keys.has(sharedBase) && !LEXICALIZED_KEEP.has(key)) {
      removed.push({ word, base: sharedBase, cue: "matched English inflection entry" });
      continue;
    }

    pruned[word] = entry;
  }

  return { pruned, removed };
}

function readJson(fileName: string): DictionaryJson {
  return JSON.parse(readFileSync(path.join(DICTIONARY_DIR, fileName), "utf-8")) as DictionaryJson;
}

function writeJson(fileName: string, data: DictionaryJson): void {
  writeFileSync(path.join(DICTIONARY_DIR, fileName), `${JSON.stringify(data)}\n`, "utf-8");
}

function main(): void {
  const dryRun = process.argv.includes("--dry-run");
  const prunedByFile = new Map<string, DictionaryJson>();
  const remainingWords = new Set<string>();
  const sharedRemovals = new Map<string, string>();

  for (const fileName of DICTIONARY_FILES) {
    const original = readJson(fileName);
    const { pruned, removed } = pruneDictionary(
      original,
      fileName === "en-50k.json" ? new Map() : sharedRemovals,
    );
    if (fileName === "en-50k.json") {
      for (const item of removed) {
        sharedRemovals.set(item.word.toLowerCase(), item.base.toLowerCase());
      }
    }
    prunedByFile.set(fileName, pruned);
    for (const word of Object.keys(pruned)) {
      remainingWords.add(word);
    }

    console.log(
      `${fileName}: ${Object.keys(original).length} -> ${Object.keys(pruned).length} ` +
        `(${removed.length} removed)`,
    );
    for (const item of removed.slice(0, 20)) {
      console.log(`  - ${item.word} -> ${item.base} (${item.cue})`);
    }
    if (removed.length > 20) {
      console.log(`  ... ${removed.length - 20} more`);
    }
  }

  const words = [...remainingWords].sort();
  console.log(`${WORD_LIST_FILE}: ${words.length} words after pruning`);

  if (dryRun) {
    console.log("Dry run only; dictionary files were not modified.");
    return;
  }

  for (const [fileName, pruned] of prunedByFile.entries()) {
    writeJson(fileName, pruned);
  }
  writeFileSync(path.join(DICTIONARY_DIR, WORD_LIST_FILE), `${words.join("\n")}\n`, "utf-8");
}

main();