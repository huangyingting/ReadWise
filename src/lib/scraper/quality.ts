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
 *  - missing author / publish-date (advisory only)
 *
 * The result is intended for **logging and operator dashboards only**.
 * PRIVACY: this module NEVER logs or persists article text, titles,
 * selected text, or any user-private content — only numeric metrics
 * and signal identifiers are emitted.
 */

import { createLogger } from "@/lib/observability/logger";

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
 * - `"reject"` — a critical check failed (empty body or word count below
 *   {@link MIN_WORD_COUNT}); content is likely garbage.  Pipeline may skip.
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
