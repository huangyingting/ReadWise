/**
 * Category-aware translation prompt variants for the provider-db prompt lab.
 *
 * Each {@link TranslationProfile} (see `categories.ts`) gets one or more
 * candidate prompts. `sample.ts` / `translate.ts` / `evaluate.ts` run these
 * against real provider-db excerpts and score them so the best variant per
 * profile can be selected empirically (see
 * `docs/ai/provider-db-translation-prompts.md` for the writeup).
 *
 * All variants translate into Simplified Chinese (zh-CN) and share the same
 * hard constraints (no commentary, no markdown fences, preserve paragraph
 * breaks) — only the register/terminology guidance differs.
 */
import type { TranslationProfile } from "./categories";
import { profileForCategory } from "./categories";

export type PromptVariant = {
  /** Stable id, e.g. "news/v2". Used as the key in result/report files. */
  id: string;
  profile: TranslationProfile;
  /** Short human label for reports. */
  label: string;
  systemPrompt: string;
};

/**
 * What must stay untranslated (or partially untranslated) and how. This was
 * previously scattered ad hoc across individual profile prompts (news
 * covered acronyms, technical covered term-glossing, narrative covered
 * foreign-word code-switching, sports covered team/athlete names) with no
 * shared rule, so the baseline prompt and any future profile had no
 * guidance at all. Centralizing it here means every variant — including the
 * baseline control — gets the same "what NOT to translate" contract, making
 * the profile-specific rules pure additions on top rather than the only
 * place this is handled.
 */
const UNTRANSLATABLE_CONTENT_RULE =
  "Some content must stay as-is rather than being rendered in Chinese: " +
  "(1) Proper nouns (people, places, organizations, products, works of art) " +
  "that have a well-established Chinese name — use that established name, " +
  "not a literal or ad hoc translation. (2) Proper nouns with NO established " +
  "Chinese name — keep the original Latin-script (or other original-script) " +
  "form; do not invent a transliteration unless the specialized guidance " +
  "below asks you to. (3) Acronyms/initialisms (e.g. NASA, GDP, CPU, DNA), " +
  "code identifiers, file paths, URLs, email addresses, and @handles/#hashtags " +
  "— always keep these in their original form, never transliterate or " +
  "translate them. (4) Numbers, dates, units of measurement, currency codes, " +
  "and mathematical/chemical symbols — keep exactly as given, only converting " +
  "notation if the source itself does (e.g. a date format), never the value. " +
  "(5) Titles of books/films/songs/papers that have an official or widely " +
  "used Chinese release title — use that title; if none exists, keep the " +
  "original title and do not improvise a translation. (6) Never fuse a " +
  "Chinese morpheme directly onto an untranslated English fragment to form a " +
  "single hybrid word (e.g. do NOT write \"缩水flation\" for \"shrinkflation\") " +
  "— either give a complete, standalone Chinese rendering, or keep the entire " +
  "original English term intact (optionally followed by a Chinese gloss in " +
  "parentheses); never split one word across the two scripts. When in doubt " +
  "between translating and preserving a term, prefer preserving it and, if " +
  "useful for readability, add a concise Chinese gloss in parentheses on " +
  "first mention.";

const SHARED_CONSTRAINTS =
  "Translate into Simplified Chinese (zh-CN). Preserve the source paragraph " +
  "breaks exactly (same number of paragraphs, same order). Output ONLY the " +
  "translated article text — no title restatement, no commentary, no notes, " +
  "no markdown fences, no explanations of your choices. Keep numbers, dates, " +
  "units, and proper nouns' original meaning intact; do not add or omit " +
  "information. " +
  UNTRANSLATABLE_CONTENT_RULE;

/**
 * v1 baseline: the same category-agnostic prompt for every profile. This is
 * the control group — effectively the existing production prompt in
 * `src/lib/ai/prompts/translation.ts`, restated here so the lab can score it
 * against the specialized variants under identical conditions.
 */
function baselinePrompt(profile: TranslationProfile): PromptVariant {
  return {
    id: `${profile}/v1-baseline`,
    profile,
    label: "Generic (category-agnostic) baseline",
    systemPrompt:
      "You are a professional translator. " +
      SHARED_CONSTRAINTS,
  };
}

const NEWS_V2 =
  "You are a professional journalistic translator producing copy for a " +
  "Chinese current-affairs outlet. Use a formal, objective news register " +
  "(新闻体): neutral verbs, no editorializing, no exclamation. Use the " +
  "standard/established Chinese rendering for well-known people, places, and " +
  "organizations (Xinhua-style transliteration conventions) when one exists; " +
  "otherwise transliterate consistently and keep the original Latin-script " +
  "name in parentheses on first mention. Keep organization acronyms " +
  "(UN, EU, GDP, etc.) in their original Latin form; do not translate them " +
  "into Chinese initials. Preserve all figures, percentages, currency " +
  "amounts, and dates exactly as given. " +
  SHARED_CONSTRAINTS;

const TECHNICAL_V2 =
  "You are a professional translator specializing in popular-science and " +
  "technology journalism for a Chinese audience (科普/科技媒体). Precision " +
  "outranks elegance: keep every technical claim, unit of measurement, " +
  "chemical/gene/drug/species/software name, and quantitative result exactly " +
  "as precise as the source. If a term has a standard Chinese technical " +
  "translation, use it; otherwise keep the English term and add a concise " +
  "Chinese gloss in parentheses on first occurrence, then use the Chinese " +
  "term consistently afterward. Do not soften, exaggerate, or simplify " +
  "scientific/medical claims beyond what the source states — this is " +
  "especially important for health content, where over- or under-stating a " +
  "finding is a factual error, not a style choice. " +
  SHARED_CONSTRAINTS;

const NARRATIVE_V2 =
  "You are a literary translator producing a Simplified Chinese feature " +
  "article for a general readership (文化/生活类特稿). Prioritize natural, " +
  "idiomatic, flowing Chinese prose (通顺自然) over literal word-for-word " +
  "translation: you may reorder clauses, split or merge sentences, and choose " +
  "idiomatic phrasing, as long as the meaning, tone, and paragraph breaks are " +
  "preserved. Use established Chinese translations for well-known people, " +
  "places, books, films, or artworks when one exists. Preserve the author's " +
  "voice — keep humor, irony, or understatement rather than flattening it " +
  "into neutral prose. " +
  SHARED_CONSTRAINTS;

/**
 * v3: literary/feature prose (New Yorker-style) frequently embeds
 * untranslated foreign words, slang, or code-switched phrases (Yiddish,
 * French, dialect). Lab testing on narrative-profile samples showed BOTH v1
 * and v2 leaving these as stray Latin-script fragments inside the Chinese
 * output (e.g. "蜂鸟般的灵动 intensity"), which the LLM judge flagged as a
 * fluency break in every affected sample. v3 adds an explicit rule for that
 * failure mode, plus a stronger fidelity reminder after judge feedback caught
 * a factual slip ("twenty thousand words" → "两万句话", i.e. "words" mistranslated
 * as "sentences") that the freedom to rephrase in v2 seems to have enabled.
 */
const NARRATIVE_V3 =
  NARRATIVE_V2 +
  " Every word must end up in Chinese: fully translate embedded slang, " +
  "dialect, or foreign-language interjections (e.g. Yiddish, French) into " +
  "natural Chinese rather than leaving the original word or a bilingual " +
  "hybrid in the sentence; the ONLY exception is a proper noun that has no " +
  "accepted Chinese form, which may stay in Latin script. Freedom to " +
  "rephrase for fluency must never change factual specifics — exact counts, " +
  "quantities, names, and figures must match the source precisely.";

const SPORTS_V2 =
  "You are a sports journalist translating into Simplified Chinese for a " +
  "Chinese sports-media audience (体育新闻). Use an energetic, punchy tone " +
  "typical of Chinese sports reporting, standard Chinese sports terminology " +
  "for leagues, positions, and statistics, and the commonly used Chinese " +
  "names for well-known teams/athletes/competitions when one exists " +
  "(otherwise transliterate consistently and keep the original name in " +
  "parentheses on first mention). Keep all scores, times, and statistics " +
  "exact. " +
  SHARED_CONSTRAINTS;

const SPECIALIZED_VERSION: Record<TranslationProfile, string> = {
  news: "v2-specialized",
  technical: "v2-specialized",
  narrative: "v3-specialized",
  sports: "v2-specialized",
};

const SPECIALIZED_PROMPTS: Record<TranslationProfile, string> = {
  news: NEWS_V2,
  technical: TECHNICAL_V2,
  narrative: NARRATIVE_V3,
  sports: SPORTS_V2,
};

function specializedPrompt(profile: TranslationProfile): PromptVariant {
  return {
    id: `${profile}/${SPECIALIZED_VERSION[profile]}`,
    profile,
    label: "Category-specialized (register + terminology guidance)",
    systemPrompt: SPECIALIZED_PROMPTS[profile],
  };
}

/** All candidate variants for a profile, in the order they should be tried. */
export function variantsForProfile(profile: TranslationProfile): PromptVariant[] {
  return [baselinePrompt(profile), specializedPrompt(profile)];
}

/** Every candidate variant across every profile, for a full lab run. */
export function allVariants(): PromptVariant[] {
  const profiles: TranslationProfile[] = ["news", "technical", "narrative", "sports"];
  return profiles.flatMap(variantsForProfile);
}

export function variantById(id: string): PromptVariant | undefined {
  return allVariants().find((v) => v.id === id);
}

/**
 * The lab's recommended production prompt per profile — see
 * `docs/ai/provider-db-translation-prompts.md` for the full evaluation
 * writeup and its caveats:
 *   - news / technical / sports: specialized and baseline scored
 *     statistically indistinguishable at the lab's small sample sizes, but
 *     the specialized variant encodes terminology/register rules (acronym
 *     handling, unit precision, established name conventions) that matter
 *     for correctness at translation scale even where a judge run this
 *     small couldn't show a measurable gap.
 *   - narrative: the specialized v3 variant fixes a *reproduced* failure
 *     mode (embedded foreign-language slang/interjections left untranslated,
 *     plus a factual-fidelity slip introduced by v2's freedom to rephrase).
 *     The aggregate judge-score ranking between v1/v3 was noisy across two
 *     full lab runs (translate.ts samples at temperature 0.3), so the
 *     fix is the trustworthy part of this recommendation, not yet the
 *     aggregate score gap.
 */
export function recommendedPrompt(profile: TranslationProfile): PromptVariant {
  return specializedPrompt(profile);
}

/** Convenience: recommended prompt for a raw `Article.category` value. */
export function recommendedPromptForCategory(category: string | null | undefined): PromptVariant {
  return recommendedPrompt(profileForCategory(category));
}
