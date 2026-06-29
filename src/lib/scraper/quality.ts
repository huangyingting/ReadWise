/**
 * Content extraction quality checks (Issue #739).
 *
 * Scores a scraped article against a battery of quality signals to catch
 * likely-bad extraction before degraded content reaches users:
 *
 *  - empty body or too-short body
 *  - paywall / subscription-gate markers (scraper captured the gate page)
 *  - encoding garbage (replacement chars, non-printable junk)
 *  - excessive link density (nav/index page captured instead of article)
 *  - boilerplate-heavy content (footer/legal text dominates)
 *  - non-English body (ads / garbage are often non-English) via `franc`
 *  - abnormally low English stopword ratio (keyword stuffing / link lists)
 *  - high ad / call-to-action keyword density (promo copy captured)
 *  - weak sentence structure (fragments / nav lists, not prose)
 *  - all-caps / punctuation spam ("shouting", advisory)
 *  - repetitive n-grams (ads repeating a product / CTA)
 *  - a local Naive-Bayes ad/article classifier (`natural`, complementary)
 *  - missing author / publish-date (advisory only)
 *
 * The result is intended for **logging and operator dashboards only**.
 * PRIVACY: this module NEVER logs or persists article text, titles,
 * selected text, or any user-private content — only numeric metrics
 * and signal identifiers are emitted.
 *
 * @server-only — depends on Node-only `franc-min` / `natural` (via the
 * classifier module); never import from a "use client" file.
 */

import { franc } from "franc-min";

import { createLogger } from "@/lib/observability/logger";
import { scraperQualityClassifier } from "@/lib/runtime-config/scraper";
import { providerForUrl } from "@/lib/scraper/providers";

import { classifyArticleText } from "./quality-classifier";

const log = createLogger("scraper.quality");

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Severity of the composite quality assessment. */
export type QualityGrade = "ok" | "warn" | "reject";

/** One named check and whether the article passed it. */
export type QualitySignal = {
  /** Short kebab-case identifier for the check. */
  check: string;
  /** `true` when the article passes this check. */
  passed: boolean;
  /** Optional non-PII detail — metrics only, never article content. */
  detail?: string;
};

/** Result returned by {@link checkContentQuality}. */
export type ContentQualityResult = {
  /** Composite grade derived from the most severe failing signal. */
  grade: QualityGrade;
  /** 0–100 composite quality score (100 = all checks pass). */
  score: number;
  /** Individual check results for logging and operator triage. */
  signals: QualitySignal[];
};

// ---------------------------------------------------------------------------
// Minimal input shape (accepts ScrapedArticle or synthetic test objects)
// ---------------------------------------------------------------------------

/**
 * Minimal article fields needed for quality assessment.
 * A full `ScrapedArticle` satisfies this interface.
 */
export type QualityInput = {
  title: string | null;
  author: string | null;
  publishedAt: Date | null;
  /** Sanitized HTML content produced by extractArticle. */
  content: string;
  wordCount: number;
  sourceUrl: string;
};

// ---------------------------------------------------------------------------
// Thresholds (exported so tests and docs can reference them directly)
// ---------------------------------------------------------------------------

/** Word count below which an article is rejected as too short. */
export const MIN_WORD_COUNT = 50;

/** Word count below which a "short-content" warning signal is raised. */
export const SHORT_WORD_COUNT = 150;

/** Reading speed used to derive estimated reading minutes (matches mapper). */
export const QUALITY_WORDS_PER_MINUTE = 200;

/** Minimum estimated reading minutes; shorter pieces are rejected as too brief. */
export const MIN_READING_MINUTES = 5;

/** Word count for the minimum reading time ({@link MIN_READING_MINUTES}). */
export const MIN_READING_WORD_COUNT = MIN_READING_MINUTES * QUALITY_WORDS_PER_MINUTE;

/**
 * Ratio of link-text characters to total plain-text characters above which
 * content is considered navigation/index-heavy.
 */
export const MAX_LINK_DENSITY = 0.5;

/**
 * Ratio of garbage Unicode codepoints (U+FFFD replacement char, BMP
 * private-use area, ASCII control chars) to total characters above which
 * encoding problems are detected.
 */
export const MAX_GARBAGE_RATIO = 0.02;

/**
 * Number of distinct boilerplate pattern matches needed before the
 * "boilerplate-heavy" signal fires.
 */
export const BOILERPLATE_HIT_THRESHOLD = 3;

/**
 * Minimum plain-text length (chars) before language detection is trusted.
 * `franc` returns `und` for shorter snippets; we treat too-short text as a pass
 * to avoid false-positive `non-english` rejections on brief content.
 */
export const MIN_LANG_TEXT_LEN = 200;

/**
 * Minimum word count before stopword-ratio / sentence-structure / repetition
 * heuristics are evaluated (they are unreliable on very short bodies).
 */
export const MIN_PROSE_WORDS = 30;

/**
 * English stopword ratio below which content is flagged as
 * keyword-stuffing / link-list junk. Genuine prose sits around 0.35–0.55.
 */
export const MIN_STOPWORD_RATIO = 0.2;

/**
 * Ad / call-to-action keyword matches per 100 words above which the body is
 * considered promotional copy rather than an article.
 */
export const MAX_AD_KEYWORD_DENSITY = 3;

/**
 * Average words-per-sentence below which content is treated as fragments /
 * navigation lists rather than prose (evaluated only for longer bodies).
 */
export const MIN_AVG_SENTENCE_WORDS = 5;

/** Uppercase-word ratio above which the advisory `shouting` signal fires. */
export const MAX_UPPERCASE_RATIO = 0.3;

/**
 * Repeated top-3-gram frequency (and share of all 3-grams) above which the
 * `repetitive` signal fires — catches ads repeating a product name / CTA.
 */
export const MAX_TRIGRAM_REPEAT_COUNT = 5;
export const MAX_TRIGRAM_REPEAT_RATIO = 0.08;

/** Classifier confidence at or above which an `ad` label lowers the score. */
export const ML_AD_CONFIDENCE = 0.85;

/**
 * Minimum plain-text length (chars) before the `code-content` heuristic is
 * evaluated. Short bodies are unreliable and must never be flagged as code.
 */
export const CODE_CONTENT_MIN_LEN = 400;

/**
 * Density of code-like symbols (`{`, `}`, `;`, `=`, plus `=>`) per character
 * above which the body looks like source/JS rather than prose. Genuine prose
 * (even technical articles quoting a little code) sits far below this — braces
 * and equals signs are essentially absent from English sentences.
 */
export const MAX_CODE_SYMBOL_DENSITY = 0.03;

/**
 * Minimum number of distinctive JS/code token matches (e.g. `function(`,
 * `addEventListener`, `=>`, `.prototype`) required — alongside high symbol
 * density — before the `code-content` signal fires. Requiring BOTH a strong
 * symbol density AND multiple code tokens keeps the check conservative so a
 * single mention of "function" in prose can never trigger a rejection.
 */
export const MIN_CODE_TOKEN_HITS = 4;

/**
 * Stopword ratio below which a body is considered to have almost no natural
 * English function words — combined with elevated symbol density this is the
 * fallback signal for minified/obfuscated code blobs.
 */
export const CODE_CONTENT_MAX_STOPWORD_RATIO = 0.05;

/** Minimum ranked/short headline items before a roundup digest can be rejected. */
export const MIN_DIGEST_LIST_ITEMS = 4;

/** Minimum parenthetical outbound source links before digest-listicle can fire. */
export const MIN_DIGEST_SOURCE_LINKS = 2;

/** Max length for short bold digest headlines. */
export const MAX_DIGEST_HEADLINE_CHARS = 90;

// ---------------------------------------------------------------------------
// Paywall / subscription-gate marker patterns
// ---------------------------------------------------------------------------

const PAYWALL_PATTERNS: RegExp[] = [
  /\bsubscribers?\s+only\b/i,
  /\bthis\s+(?:content|article)\s+is\s+(?:for\s+)?(?:subscribers?|members?|premium)\b/i,
  /\bsign[\s-]*in\s+to\s+(?:read|continue|access)\b/i,
  /\bregister\s+to\s+(?:read|continue|access)\b/i,
  /\bcreate\s+an?\s+account\s+to\s+(?:read|continue|access)\b/i,
  /\byou(?:'ve|\s+have)\s+(?:reached|hit)\s+(?:your\s+)?(?:free\s+)?(?:article|reading)\s+limit\b/i,
  /\bget\s+(?:unlimited\s+)?(?:access|articles)\s+(?:with\s+a\s+)?subscription\b/i,
  /\bbecome\s+a\s+member\s+to\s+(?:continue|read|access)\b/i,
];

// ---------------------------------------------------------------------------
// Boilerplate / footer / legal keyword patterns
// ---------------------------------------------------------------------------

const BOILERPLATE_PATTERNS: RegExp[] = [
  /\bcopyright\s+©?\s*\d{4}\b/i,
  /\ball\s+rights\s+reserved\b/i,
  /\bprivacy\s+policy\b/i,
  /\bterms\s+(?:of\s+)?(?:use|service|conditions)\b/i,
  /\bcookie\s+(?:policy|settings|preferences)\b/i,
  /\badvertise\s+with\s+us\b/i,
  /\bdo\s+not\s+sell\s+my\s+(?:personal\s+)?(?:information|data)\b/i,
];

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Strip HTML tags to get plain text for pattern matching. */
function toPlainText(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

/** Concatenate text content of all <a> elements in the HTML. */
function extractLinkText(html: string): string {
  return [...html.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)]
    .map((m) => m[1]!.replace(/<[^>]*>/g, " ").trim())
    .join(" ");
}

/** Count codepoints that indicate encoding corruption. */
function countGarbageChars(text: string): number {
  let count = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (
      cp === 0xfffd || // UTF-8 replacement character
      (cp >= 0xe000 && cp <= 0xf8ff) || // BMP private-use area
      cp < 0x09 || // ASCII control chars below HT
      (cp > 0x0d && cp < 0x20) // ASCII control chars above CR, below space
    ) {
      count++;
    }
  }
  return count;
}

// ---------------------------------------------------------------------------
// Prose-quality heuristics: stopwords, ad keywords, sentences, repetition
// ---------------------------------------------------------------------------

/** Small built-in English stopword set (function words). */
const ENGLISH_STOPWORDS = new Set<string>(
  (
    "the a an and or but of to in on at for with by from as is are was were be been being " +
    "this that these those it its he she they we you i him her them his their our your my me us " +
    "not no nor can will would should could have has had do does did so if then than too very " +
    "about into over under again further once here there all any both each few more most other some such " +
    "only own same out up down off above below between through during before after while because " +
    "what which who whom whose when where why how"
  ).split(/\s+/),
);

/** Ad / call-to-action keyword patterns counted toward promo-copy density. */
const AD_KEYWORD_PATTERNS: RegExp[] = [
  /\bsubscribe\b/gi,
  /\bsign\s*up\b/gi,
  /\bbuy\s+now\b/gi,
  /\bshop\s+now\b/gi,
  /\bsponsored\b/gi,
  /\badvertisement\b/gi,
  /\bclick\s+here\b/gi,
  /\bcoupon\b/gi,
  /\bpromo(?:\s*code)?\b/gi,
  /\blimited\s+time\b/gi,
  /\bsale\b/gi,
  /\bdeals?\b/gi,
  /\bfree\s+shipping\b/gi,
  /\border\s+now\b/gi,
  /\d+\s*%\s*off\b/gi,
  /\$\s?\d/g,
];

/** Lowercased word tokens (letters + apostrophes) from plain text. */
function tokenizeWords(plainText: string): string[] {
  return plainText.toLowerCase().match(/[a-z']+/g) ?? [];
}

/** Ratio of English stopwords to total words (0 when no words). */
function stopwordRatio(tokens: string[]): number {
  if (tokens.length === 0) return 0;
  let hits = 0;
  for (const t of tokens) if (ENGLISH_STOPWORDS.has(t)) hits++;
  return hits / tokens.length;
}

/** Total ad/CTA keyword matches across the plain text. */
function countAdKeywords(plainText: string): number {
  let total = 0;
  for (const re of AD_KEYWORD_PATTERNS) {
    total += (plainText.match(re) ?? []).length;
  }
  return total;
}

/** Sentence count + average words-per-sentence (split on . ! ?). */
function sentenceStats(plainText: string, wordTotal: number): { count: number; avgWords: number } {
  const sentences = plainText
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const count = sentences.length;
  const avgWords = count > 0 ? wordTotal / count : wordTotal;
  return { count, avgWords };
}

/** Ratio of ALL-CAPS words (length ≥ 3) to total words. */
function uppercaseWordRatio(plainText: string): number {
  const words = plainText.match(/[A-Za-z]{3,}/g) ?? [];
  if (words.length === 0) return 0;
  let upper = 0;
  for (const w of words) if (w === w.toUpperCase()) upper++;
  return upper / words.length;
}

/** Highest 3-gram frequency and its share of all 3-grams. */
function topTrigramRepetition(tokens: string[]): { maxCount: number; ratio: number } {
  if (tokens.length < 3) return { maxCount: 0, ratio: 0 };
  const freq = new Map<string, number>();
  let total = 0;
  for (let i = 0; i + 2 < tokens.length; i++) {
    const gram = `${tokens[i]} ${tokens[i + 1]} ${tokens[i + 2]}`;
    const next = (freq.get(gram) ?? 0) + 1;
    freq.set(gram, next);
    total++;
  }
  let maxCount = 0;
  for (const c of freq.values()) if (c > maxCount) maxCount = c;
  return { maxCount, ratio: total > 0 ? maxCount / total : 0 };
}

/**
 * Distinctive source-code / JavaScript token patterns. A leaked analytics
 * snippet or minified bundle matches many of these; ordinary prose matches
 * (almost) none. Patterns are global so we can count total occurrences.
 */
const CODE_TOKEN_PATTERNS: RegExp[] = [
  /\bfunction\s*\(/g,
  /=>/g,
  /=\s*function\b/g,
  /\bvar\s+[A-Za-z_$]/g,
  /\b(?:let|const)\s+[A-Za-z_$]/g,
  /\.prototype\b/g,
  /\baddEventListener\b/g,
  /\bNREUM\b/g,
  /\b(?:typeof|undefined|null|return|else|catch|new)\b\s*[({[]/g,
  /\)\s*\{/g,
  /\}\s*\)/g,
  /;\s*\}/g,
  /\.(?:push|call|apply|bind|forEach|map)\s*\(/g,
];

/**
 * Measures how "code-like" the plain text is.
 *
 * `symbolDensity` is the share of characters that are code punctuation
 * (`{ } ; =`) — essentially zero in English prose, high in source. `tokenHits`
 * counts distinctive JS tokens (see {@link CODE_TOKEN_PATTERNS}).
 */
function codeContentSignal(plainText: string): { symbolDensity: number; tokenHits: number } {
  const len = plainText.length;
  if (len === 0) return { symbolDensity: 0, tokenHits: 0 };
  const symbols = (plainText.match(/[{};=]/g) ?? []).length + (plainText.match(/=>/g) ?? []).length;
  let tokenHits = 0;
  for (const re of CODE_TOKEN_PATTERNS) tokenHits += (plainText.match(re) ?? []).length;
  return { symbolDensity: symbols / len, tokenHits };
}

function countDigestNumberedItems(html: string, plainText: string): number {
  const blockMatches = [...html.matchAll(/<(?:p|li|h[2-6])\b[^>]*>\s*(?:<[^>]+>\s*)*([1-9]\.?\s+[A-Z][\s\S]*?)<\/(?:p|li|h[2-6])>/gi)]
    .filter((m) => toPlainText(m[1] ?? "").length <= 180).length;
  const plainMatches = plainText.match(/\b[1-9]\.?\s+[A-Z][^.!?]{5,120}/g)?.length ?? 0;
  return Math.max(blockMatches, plainMatches);
}

function countShortStrongHeadlines(html: string): number {
  return [...html.matchAll(/<(?:strong|b)\b[^>]*>([\s\S]*?)<\/(?:strong|b)>/gi)]
    .map((m) => toPlainText(m[1] ?? ""))
    .filter(
      (text) =>
        text.length > 0 &&
        text.length <= MAX_DIGEST_HEADLINE_CHARS &&
        /^[A-Z0-9]/.test(text) &&
        /[a-z]/.test(text),
    ).length;
}

function countParentheticalOutboundLinks(html: string, sourceUrl: string): number {
  let sourceHost: string | null = null;
  try {
    sourceHost = new URL(sourceUrl).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    sourceHost = null;
  }
  let count = 0;
  for (const match of html.matchAll(/\(\s*<a\b[^>]*href=["']([^"']+)["'][^>]*>[\s\S]{1,120}?<\/a>\s*\)/gi)) {
    const href = match[1];
    if (!href || !/^https?:\/\//i.test(href)) continue;
    if (sourceHost) {
      try {
        const linkHost = new URL(href).hostname.replace(/^www\./, "").toLowerCase();
        if (linkHost === sourceHost) continue;
      } catch {
        continue;
      }
    }
    count++;
  }
  return count;
}

function digestListicleSignal(article: QualityInput, plainText: string): {
  hit: boolean;
  numberedItems: number;
  strongHeadlines: number;
  sourceLinks: number;
} {
  const title = article.title?.trim() ?? "";
  const headerHit = /\bthe\s+must-?reads\b/i.test(plainText);
  const providerDigestPrefixHit =
    providerForUrl(article.sourceUrl)?.quality?.digestListicleTitlePrefixes?.some((prefix) => {
      const normalizedPrefix = prefix.trim().toLowerCase();
      return (
        normalizedPrefix.length > 0 &&
        (title.toLowerCase().startsWith(normalizedPrefix) ||
          plainText.toLowerCase().startsWith(normalizedPrefix))
      );
    }) ?? false;
  const numberedItems = countDigestNumberedItems(article.content, plainText);
  const strongHeadlines = countShortStrongHeadlines(article.content);
  const sourceLinks = countParentheticalOutboundLinks(article.content, article.sourceUrl);
  const enoughItems =
    numberedItems >= MIN_DIGEST_LIST_ITEMS || strongHeadlines >= MIN_DIGEST_LIST_ITEMS;
  return {
    hit: (headerHit || providerDigestPrefixHit) && enoughItems && sourceLinks >= MIN_DIGEST_SOURCE_LINKS,
    numberedItems,
    strongHeadlines,
    sourceLinks,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Scores a scraped article against content-quality signals and returns a
 * structured result for logging and operator triage.
 *
 * Grade semantics:
 * - `"ok"` — all critical and major checks pass.
 * - `"warn"` — at least one major quality signal fired (paywall, encoding,
 *   link density, boilerplate); content may be degraded.  Pipeline should
 *   persist but log for review.
 * - `"reject"` — a critical check failed (empty body, word count below
 *   {@link MIN_WORD_COUNT}, or a confidently non-English body); content is
 *   likely garbage.  Pipeline may skip.
 *
 * **Never pass the result's `.signals[].detail` or any article text to logs
 * directly — only log the returned grade, score, and failed check names.**
 */
export function checkContentQuality(article: QualityInput): ContentQualityResult {
  const signals: QualitySignal[] = [];
  let deductions = 0;
  let hasReject = false;
  let hasMajorWarn = false;

  const plainText = toPlainText(article.content);
  const textLen = plainText.length;

  // ── Critical: empty body ───────────────────────────────────────────────────
  const emptyBody = textLen === 0;
  signals.push({ check: "empty-body", passed: !emptyBody, detail: `textLen=${textLen}` });
  if (emptyBody) {
    hasReject = true;
    deductions += 100;
  }

  // ── Critical: word count too low ───────────────────────────────────────────
  const { wordCount } = article;
  const tooShort = wordCount < MIN_WORD_COUNT;
  const barelyShort = !tooShort && wordCount < SHORT_WORD_COUNT;
  signals.push({ check: "word-count", passed: !tooShort, detail: `words=${wordCount}` });
  if (tooShort) {
    hasReject = true;
    deductions += 50;
  } else if (barelyShort) {
    deductions += 10;
  }

  // ── Critical: under minimum reading time (< 5 min) ─────────────────────────
  const tooBrief = wordCount < MIN_READING_WORD_COUNT;
  signals.push({
    check: "reading-time",
    passed: !tooBrief,
    detail: `words=${wordCount} minWords=${MIN_READING_WORD_COUNT}`,
  });
  if (tooBrief && !tooShort) {
    hasReject = true;
    deductions += 40;
  }

  if (!emptyBody) {
    // ── Major: paywall / subscription gate ────────────────────────────────────
    const paywallHit = PAYWALL_PATTERNS.some((re) => re.test(plainText));
    signals.push({ check: "paywall-marker", passed: !paywallHit });
    if (paywallHit) {
      hasMajorWarn = true;
      deductions += 30;
    }

    // ── Major: encoding garbage ───────────────────────────────────────────────
    const garbageCount = countGarbageChars(plainText);
    const garbageRatio = garbageCount / textLen;
    const garbageHit = garbageRatio > MAX_GARBAGE_RATIO;
    signals.push({
      check: "encoding-garbage",
      passed: !garbageHit,
      detail: `garbageRatio=${garbageRatio.toFixed(4)}`,
    });
    if (garbageHit) {
      hasMajorWarn = true;
      deductions += 25;
    }

    // ── Major: excessive link density ─────────────────────────────────────────
    const linkText = extractLinkText(article.content);
    const linkLen = linkText.replace(/\s+/g, " ").trim().length;
    const linkDensity = textLen > 0 ? linkLen / textLen : 0;
    const linkDenseHit = linkDensity > MAX_LINK_DENSITY;
    signals.push({
      check: "link-density",
      passed: !linkDenseHit,
      detail: `linkDensity=${linkDensity.toFixed(3)}`,
    });
    if (linkDenseHit) {
      hasMajorWarn = true;
      deductions += 20;
    }

    // ── Major: boilerplate-heavy ──────────────────────────────────────────────
    const boilerplateHits = BOILERPLATE_PATTERNS.filter((re) => re.test(plainText)).length;
    const boilerplateHeavy = boilerplateHits >= BOILERPLATE_HIT_THRESHOLD;
    signals.push({
      check: "boilerplate-heavy",
      passed: !boilerplateHeavy,
      detail: `boilerplateHits=${boilerplateHits}`,
    });
    if (boilerplateHeavy) {
      hasMajorWarn = true;
      deductions += 20;
    }

    // Shared tokenization for the prose-quality heuristics below.
    const tokens = tokenizeWords(plainText);
    const wordTotal = tokens.length;
    const proseReliable = wordTotal >= MIN_PROSE_WORDS;

    // ── Critical: code-like content (leaked scripts / minified JS) ────────────
    // Defense-in-depth for extractions that captured inline analytics or source
    // text. Requires a MEANINGFUL span plus BOTH a high code-symbol density AND
    // multiple distinctive JS tokens (or near-zero stopwords with elevated
    // symbol density) so genuine prose — even an article quoting a little code —
    // is never rejected.
    const { symbolDensity, tokenHits } = codeContentSignal(plainText);
    const stopRatioForCode = proseReliable ? stopwordRatio(tokens) : 1;
    const strongCode =
      tokenHits >= MIN_CODE_TOKEN_HITS && symbolDensity >= MAX_CODE_SYMBOL_DENSITY;
    const minifiedCode =
      tokenHits >= MIN_CODE_TOKEN_HITS &&
      stopRatioForCode <= CODE_CONTENT_MAX_STOPWORD_RATIO &&
      symbolDensity >= MAX_CODE_SYMBOL_DENSITY * 0.75;
    const codeContent = textLen >= CODE_CONTENT_MIN_LEN && (strongCode || minifiedCode);
    signals.push({
      check: "code-content",
      passed: !codeContent,
      detail: `symbolDensity=${symbolDensity.toFixed(3)} codeTokens=${tokenHits}`,
    });
    if (codeContent) {
      hasReject = true;
      deductions += 60;
    }

    // ── Critical: roundup/newsletter digest listicle ─────────────────────────
    // Conservative detector for pages like MIT Technology Review's "The
    // Download" where the extraction is a roundup of must-read links rather
    // than a standalone article. Requires a digest header/title AND list-like
    // structure AND multiple parenthetical outbound source links.
    const digest = digestListicleSignal(article, plainText);
    signals.push({
      check: "digest-listicle",
      passed: !digest.hit,
      detail: `numberedItems=${digest.numberedItems} strongHeadlines=${digest.strongHeadlines} sourceLinks=${digest.sourceLinks}`,
    });
    if (digest.hit) {
      hasReject = true;
      deductions += 60;
    }

    // ── Critical: non-English body (ads / garbage are often non-English) ──────
    // Guarded by a minimum text length: `franc` returns `und` for short text,
    // which we treat as a pass to avoid false positives on brief snippets.
    let nonEnglish = false;
    if (textLen >= MIN_LANG_TEXT_LEN && proseReliable) {
      const lang = franc(plainText);
      nonEnglish = lang !== "und" && lang !== "eng";
      signals.push({ check: "non-english", passed: !nonEnglish, detail: `lang=${lang}` });
    } else {
      signals.push({ check: "non-english", passed: true, detail: "lang=skipped" });
    }
    if (nonEnglish) {
      hasReject = true;
      deductions += 60;
    }

    // ── Major: abnormally low English stopword ratio (keyword stuffing) ───────
    let lowStopwordPassed = true;
    if (proseReliable) {
      const ratio = stopwordRatio(tokens);
      lowStopwordPassed = ratio >= MIN_STOPWORD_RATIO;
      signals.push({
        check: "low-stopword-ratio",
        passed: lowStopwordPassed,
        detail: `stopwordRatio=${ratio.toFixed(3)}`,
      });
      if (!lowStopwordPassed) {
        hasMajorWarn = true;
        deductions += 25;
      }
    } else {
      signals.push({ check: "low-stopword-ratio", passed: true, detail: "stopwordRatio=skipped" });
    }

    // ── Major: ad / call-to-action keyword density ───────────────────────────
    let adCopyHit = false;
    if (wordTotal >= 20) {
      const adHits = countAdKeywords(plainText);
      const adDensity = (adHits / wordTotal) * 100;
      adCopyHit = adDensity > MAX_AD_KEYWORD_DENSITY;
      signals.push({
        check: "ad-copy",
        passed: !adCopyHit,
        detail: `adDensity=${adDensity.toFixed(2)}`,
      });
      if (adCopyHit) {
        hasMajorWarn = true;
        deductions += 25;
      }
    } else {
      signals.push({ check: "ad-copy", passed: true, detail: "adDensity=skipped" });
    }

    // ── Major: weak sentence structure (fragments / nav lists) ───────────────
    let weakSentencePassed = true;
    if (wordTotal >= 40) {
      const { count, avgWords } = sentenceStats(plainText, wordTotal);
      const weak = count < 2 || avgWords < MIN_AVG_SENTENCE_WORDS;
      weakSentencePassed = !weak;
      signals.push({
        check: "weak-sentence-structure",
        passed: weakSentencePassed,
        detail: `sentences=${count} avgWords=${avgWords.toFixed(1)}`,
      });
      if (weak) {
        hasMajorWarn = true;
        deductions += 20;
      }
    } else {
      signals.push({ check: "weak-sentence-structure", passed: true, detail: "sentences=skipped" });
    }

    // ── Advisory: all-caps / punctuation spam ("shouting") ───────────────────
    const upperRatio = uppercaseWordRatio(plainText);
    const punctSpam = /[!?]{3,}/.test(plainText);
    const shouting = upperRatio > MAX_UPPERCASE_RATIO || punctSpam;
    signals.push({
      check: "shouting",
      passed: !shouting,
      detail: `upperRatio=${upperRatio.toFixed(3)}`,
    });
    if (shouting) deductions += 5;

    // ── Major: repetitive n-grams (ads repeating a product / CTA) ────────────
    let repetitive = false;
    if (proseReliable) {
      const { maxCount, ratio } = topTrigramRepetition(tokens);
      repetitive = maxCount >= MAX_TRIGRAM_REPEAT_COUNT && ratio >= MAX_TRIGRAM_REPEAT_RATIO;
      signals.push({
        check: "repetitive",
        passed: !repetitive,
        detail: `maxTrigram=${maxCount} ratio=${ratio.toFixed(3)}`,
      });
      if (repetitive) {
        hasMajorWarn = true;
        deductions += 15;
      }
    } else {
      signals.push({ check: "repetitive", passed: true, detail: "maxTrigram=skipped" });
    }

    // ── Major: local Naive-Bayes ad classifier (env-gated, conservative) ─────
    // Complements the heuristics; never the sole basis for rejection. Skipped
    // for content that already looks like a clean, sufficiently long article so
    // a misclassification can never down-rank a genuine long-form piece.
    const looksCleanArticle =
      lowStopwordPassed && weakSentencePassed && !nonEnglish && wordCount >= SHORT_WORD_COUNT;
    if (scraperQualityClassifier() && wordCount >= MIN_WORD_COUNT && !looksCleanArticle) {
      const { label, confidence } = classifyArticleText(plainText);
      const mlAd = label === "ad" && confidence >= ML_AD_CONFIDENCE;
      if (mlAd) {
        signals.push({
          check: "ml-ad-classifier",
          passed: false,
          detail: `label=ad confidence=${confidence.toFixed(2)}`,
        });
        hasMajorWarn = true;
        deductions += 25;
      } else {
        signals.push({
          check: "ml-ad-classifier",
          passed: true,
          detail: `label=${label} confidence=${confidence.toFixed(2)}`,
        });
      }
    }
  }

  // ── Advisory: missing author ──────────────────────────────────────────────
  const missingAuthor = !article.author;
  signals.push({ check: "missing-author", passed: !missingAuthor });
  if (missingAuthor) deductions += 5;

  // ── Advisory: missing publish date ────────────────────────────────────────
  const missingDate = !article.publishedAt;
  signals.push({ check: "missing-date", passed: !missingDate });
  if (missingDate) deductions += 5;

  // ── Composite score + grade ───────────────────────────────────────────────
  const score = Math.max(0, 100 - deductions);
  const grade: QualityGrade = hasReject ? "reject" : hasMajorWarn ? "warn" : "ok";

  // Log only non-PII metrics: grade, score, word count, failed check names.
  if (grade !== "ok") {
    const failedChecks = signals.filter((s) => !s.passed).map((s) => s.check);
    log.warn("content quality degraded", {
      grade,
      score,
      wordCount,
      failedChecks,
      sourceUrl: article.sourceUrl,
    });
  } else {
    log.debug("content quality ok", { score, wordCount, sourceUrl: article.sourceUrl });
  }

  return { grade, score, signals };
}
