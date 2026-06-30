/**
 * Declutter pass — removes non-article boilerplate that a generic extractor
 * (Readability / @extractus) leaves behind in already-extracted article HTML.
 *
 * This runs AFTER body extraction and BEFORE sanitize. It targets residue that
 * structural extractors miss:
 *   1. the trailing author byline/bio paragraph at the bottom of the article,
 *      and short leading author/date/credits residue at the very top,
 *   2. related / newsletter / share / comments boilerplate blocks,
 *   3. standalone image-credit lines,
 *   4. high-link-density widgets (related/nav lists masquerading as prose).
 *
 * It is deliberately conservative: if the aggressive removals would delete more
 * than ~35% of the original text it falls back to only the highest-confidence
 * removals (or none), always preferring false negatives over gutting an article.
 *
 * @server-only — relies on linkedom (Node DOM); never import from a "use
 * client" file.
 */
import { parseHTML } from "linkedom";

export interface DeclutterOptions {
  /** Author string from Readability — used to locate & strip the matching byline. */
  byline?: string | null;
  /** Explicit author name hint (alias of byline). */
  authorName?: string | null;
  /** Publication date from metadata — used to strip matching standalone date residue. */
  publishedAt?: Date | string | null;
  /** Provider key for narrow provider-specific DOM chrome residue cleanup. */
  providerKey?: string | null;
}

/**
 * Class/id/role/aria-label vocabulary that marks non-article boilerplate.
 * Mirrors (and extends) `BOILERPLATE_PATTERN` in `src/lib/sanitize.ts` so the
 * class/id heuristics stay consistent with the rest of the pipeline.
 */
const BOILERPLATE_ATTR_RE =
  /\b(ad|ads|adsense|advert|advertisement|sponsor|sponsored|promo|promotion|newsletter|subscribe|signup|sign-?up|social|share|sharing|related|recommend|recommended|comment|comments|disqus|cookie|consent|popup|modal|overlay|paywall|banner|trending|read-?more|more-?from|up-?next|you-?may-?also|author-?bio|byline|newsletter-?cta)\b/i;

/** Block-level tags we are willing to inspect and remove wholesale. */
const BLOCK_SELECTOR =
  "p,div,section,aside,ul,ol,figure,blockquote,nav,header,footer,h1,h2,h3,h4,h5,h6";

/** Short label phrases that head a boilerplate widget (e.g. "Related"). */
const LABEL_RE =
  /^(related(\s+(articles|stories|posts|reading|content))?|more\s+(from|stories|in|on|articles)|more\s+like\s+this|also\s+read|read\s+(more|next)|recommended(\s+(for\s+you|stories|articles|reading))?|what\s+to\s+read\s+next|you\s+(may|might)\s+also\s+(like|enjoy|read)|up\s+next|newsletter|subscribe|sign\s?up|share\s+this(\s+article)?|follow\s+us(\s+on)?|comments?|trending|latest\s+(stories|articles|news)|sponsored|advert(isement)?|around\s+the\s+web|from\s+around\s+the\s+web|most\s+(popular|read)|in\s+this\s+series|explore\s+more)\b/i;

/**
 * Strong CTA / boilerplate phrases used for TEXT-based detection of class-less
 * blocks. Readability strips class/id attributes, so e.g. `<div class="newsletter">`
 * becomes a bare `<p>Subscribe to our weekly newsletter…</p>` that escapes the
 * attribute detectors above. This catches SHORT blocks whose normalized text
 * matches one of these phrases (word-boundary, case-insensitive).
 */
const TEXT_BOILERPLATE_RE =
  /^(subscribe\s+(now|today|to\s+(our|the)\s+(?:[a-z0-9-]+\s+){0,3}newsletter|for\s+(our|the)\s+(?:[a-z0-9-]+\s+){0,3}newsletter)|share\s+this\s+(article|story)|follow\s+us|follow\s+me|read\s+(more|next)|also\s+read|more\s+from|more\s+like\s+this|related\s+(stories|articles|reading)|recommended\s+(for\s+you|stories|articles|reading)|you\s+may\s+also\s+like|what\s+to\s+read\s+next|up\s+next|advertisement|sponsored|support\s+our\s+(work|journalism)|become\s+a\s+subscriber|already\s+a\s+subscriber|create\s+a\s+free\s+account|view\s+comments|leave\s+a\s+comment)\b/i;

const NEWSLETTER_CTA_CONTEXT_RE =
  /^(subscribe|sign\s?up|get|receive|join)\b(?=[^.!?]{0,180}\bnewsletters?\b)(?=[^.!?]{0,180}\b(in\s+your\s+inbox|inbox|e-?mail|delivered?|delivery|sign\s?up|subscribe|subscription|subscriber)\b)|^(?:the\s+)?latest\b(?=[^.!?]{0,120}\b(in\s+your\s+inbox|inbox|e-?mail|delivered?|delivery|sign\s?up|subscribe|subscription|subscriber)\b)/i;

const GET_LATEST_CTA_CONTEXT_RE =
  /^get\s+(the\s+)?latest(\s+(stories|articles|news|updates?|headlines|alerts?))?\b(?=[^.!?]{0,180}\b(in\s+your\s+inbox|inbox|e-?mail|delivered?\s+(to|straight|directly)|sign\s?up|subscribe|subscription)\b)/i;

const SIGNUP_CTA_CONTEXT_RE =
  /^sign\s?up\b(?=[^.!?]{0,160}\b(newsletters?|subscribers?|subscriptions?|account|membership|trial|offer|deal|promo|promotion|discount|sale|save|updates?|alerts?|inbox)\b)/i;

const SIGNUP_RESIDUE_RE =
  /^(stay\s+connected|get\s+the\s+latest\s+updates\s*(?:from)?|discover\s+special\s+offers|thank\s+you\s+for\s+submitting|it\s+looks\s+like\s+something\s+went\s+wrong)\b/i;

const TRAILING_PUBLICATION_CTA_RE =
  /^enjoying\s+.{1,80}\?\s+subscribe\s+to\s+our\s+free\s+newsletter\.?$/i;

const TECHNOLOGY_REVIEW_NEWSLETTER_ORIGIN_RE =
  /^this\s+story\s+originally\s+appeared\s+in\s+the\s+algorithm\b(?=[\s\S]{0,300}\bweekly\s+newsletter\b)(?=[\s\S]{0,300}\bsign\s?up\b)/i;

const ARCHIVE_LINK_RESIDUE_RE = /\barchive\s+page\b/i;

const RECIRC_RANKED_ITEM_RE = /^\d+\s+.*\b(most\s+popular|trending|recommended\s+for\s+you|you\s+may\s+also\s+like)\b/i;

const ORPHAN_VIDEO_LABEL_RE = /^(featured\s+video|watch:?|video)$/i;

const TIKTOK_HOST_RE = /(?:^|\.)tiktok\.com$/i;

const BYLINE_PREFIX_RE =
  /^(by|words by|written by|story by|reported by|photographs? by|illustrations? by|edited by|reporting by)\s+[\p{Lu}@]/u;

const AUTHOR_ROLE_RE =
  /\b(?:[\p{Lu}][\p{Ll}]+|he|she|they)\s+(?:is|was)\s+(?:a|an|the)\s+(?:senior\s+|staff\s+|freelance\s+|contributing\s+|former\s+|award-winning\s+)*(?:writer|journalist|reporter|editor|contributor|columnist|correspondent|author|blogger|essayist|critic|broadcaster|producer)\b/u;

const SOCIAL_AUTHOR_RE =
  /(^|\s)@[a-z0-9_]{2,}\b|\bfollow\s+(me|us|her|him|them|@)|\b(twitter|x|instagram|threads|mastodon|facebook|bluesky|linkedin)\.com\/|\bfind\s+(me|her|him|them)\s+on\b/i;

const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

const MONTH_NAME_RE =
  /^(?:(?:published|published on|posted|posted on|updated|last updated)\s*:?\s*)?(?:(?:mon|tue|wed|thu|fri|sat|sun)(?:day)?\s*,\s*)?(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?\s*,?\s+(\d{4})(?:\s+(?:at|,)?\s*\d{1,2}:\d{2}\s*(?:a\.?m\.?|p\.?m\.?)?(?:\s*(?:et|est|edt|ct|cst|cdt|mt|mst|mdt|pt|pst|pdt|utc|gmt))?)?$/i;
const ISO_DATE_RE =
  /^(?:(?:published|published on|posted|posted on|updated|last updated)\s*:?\s*)?(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/i;

const IMAGE_CREDIT_MAXLEN = 240;
const IMAGE_CREDIT_RE =
  /^\(?\s*image\s+credits?\s*(?::|：|-|–|—)\s*\S[\s\S]*?\s*\)?$/i;
const STANDALONE_CREDIT_LINE_RE =
  /^\(?\s*(?:courtesy\s+of|credits?\s*(?::|：|-|–|—)|(?:photo(?:graph)?|image|illustration)\s+(?:by|courtesy\s+of|credits?\s*(?::|：|-|–|—)))\s+\S[\s\S]*?\s*\)?$/i;
const IMAGE_CREDIT_HEADING_RE = /^\(?\s*image\s+credits?\s*\)?$/i;

const IMAGE_BOILERPLATE_RE =
  /\b(favicon|sprite|pixel|newsletter|promo|promotion|sign-?up|subscribe)\b/i;

const SMITHSONIAN_AUTHOR_IMAGE_RE =
  /(?:^|[/_.-])(?:author|avatar|headshot|profile)(?:[/_.-]|$)|\/accounts\/headshot\//i;
const SMITHSONIAN_BYLINE_ROLE_RE =
  /\|\s*(?:(?:history|science|arts?\s*&?\s*culture|travel|innovation)\s+)?(?:correspondent|writer|contributor|editor|author|reporter)\b/i;

/**
 * Max length of a block we are willing to flag purely on a text-boilerplate
 * phrase. Keeps the heuristic conservative: a long paragraph that merely
 * contains "subscribe" mid-prose must NOT be removed.
 */
const TEXT_BOILERPLATE_MAXLEN = 500;

const HIGH = 2;
const MEDIUM = 1;

const WRAPPER_ID = "__rw_declutter_root__";

/** How many trailing leaf blocks to scan when hunting the author byline. */
const TRAILING_SCAN = 8;
/** How many LEADING leaf blocks to scan for a credits/author-bio block. */
const LEADING_SCAN = 2;
/** Max length of a leading block we are willing to treat as credits/byline. */
const LEADING_BYLINE_MAXLEN = 300;
/** Fraction of original text above which aggressive removals are aborted. */
const MAX_REMOVAL_RATIO = 0.35;
/** Minimum remaining prose before allowing high-confidence removals past ratio. */
const MIN_REMAINING_TEXT_AFTER_HIGH_CONFIDENCE = 300;

interface Candidate {
  el: Element;
  confidence: number;
}

/** Lowercase + collapse whitespace for tolerant text comparison. */
function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

/** Strip punctuation/diacritic noise so name comparison is forgiving. */
function normalizeName(value: string): string {
  return normalizeText(value).replace(/[^a-z0-9 ]+/g, "").trim();
}

function parsedDateParts(value: string): { year: number; month: number; day: number } | null {
  const monthName = value.trim().match(MONTH_NAME_RE);
  if (monthName) {
    const month = MONTHS[monthName[1].toLowerCase().replace(/\.$/, "")];
    const day = Number(monthName[2]);
    const year = Number(monthName[3]);
    if (month && day >= 1 && day <= 31) return { year, month, day };
  }

  const iso = value.trim().match(ISO_DATE_RE);
  if (iso) {
    const year = Number(iso[1]);
    const month = Number(iso[2]);
    const day = Number(iso[3]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) return { year, month, day };
  }

  return null;
}

function dateHintParts(value: Date | string | null | undefined): {
  year: number;
  month: number;
  day: number;
} | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isNaN(date.getTime())) {
    return {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
    };
  }
  return typeof value === "string" ? parsedDateParts(value) : null;
}

function sameDateParts(
  a: { year: number; month: number; day: number },
  b: { year: number; month: number; day: number },
): boolean {
  return a.year === b.year && a.month === b.month && a.day === b.day;
}

function isStandaloneDateLine(
  text: string,
  publishedParts: { year: number; month: number; day: number } | null,
): boolean {
  const parts = parsedDateParts(text);
  if (!parts) return false;
  return !publishedParts || sameDateParts(parts, publishedParts);
}

function isStandaloneAuthorLine(text: string, normName: string | null): boolean {
  if (!normName) return false;
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.length > 120) return false;
  const norm = normalizeName(trimmed.replace(/^by\s+/i, ""));
  return norm.length > 0 && norm === normName;
}

/** A "leaf" block has no descendant block element — it holds actual prose. */
function isLeafBlock(el: Element): boolean {
  return el.querySelector(BLOCK_SELECTOR) === null;
}

function attrHaystack(el: Element): string {
  return [
    el.getAttribute("class"),
    el.getAttribute("id"),
    el.getAttribute("role"),
    el.getAttribute("aria-label"),
    el.getAttribute("data-ad"),
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * Confidence that a trailing block is an author byline/bio.
 * Returns 0 (not a byline), MEDIUM (pattern-based), or HIGH (matches the
 * author-name hint supplied by the extractor).
 */
function bylineConfidence(text: string, normName: string | null): number {
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;
  const norm = normalizeText(trimmed);

  // Strongest signal: paragraph mentions the known author and is short enough
  // to be a byline/bio rather than a body paragraph that happens to cite them.
  if (normName && trimmed.length <= 400) {
    const normBody = normalizeName(trimmed);
    if (normName.length > 0 && normBody.includes(normName)) {
      if (isStandaloneAuthorLine(trimmed, normName)) return HIGH;
      if (
        normBody.startsWith(normName) &&
        /\b(reports?|writes?|covers?|is|was|contributes?|serves?)\b/i.test(trimmed)
      ) {
        return HIGH;
      }
    }
  }

  // "By Jane Doe", "Words by …", "Written by …" at the very start.
  if (BYLINE_PREFIX_RE.test(trimmed)) {
    return MEDIUM;
  }

  // "Jane is a senior writer at Example", "She is the author of …".
  if (AUTHOR_ROLE_RE.test(trimmed)) {
    return MEDIUM;
  }
  if (/\bis the author of\b/i.test(trimmed)) return MEDIUM;

  // Social handles / follow CTAs / profile links.
  if (SOCIAL_AUTHOR_RE.test(trimmed)) {
    return MEDIUM;
  }

  // "Read more from Jane Doe".
  if (/^read more (from|by)\b/i.test(trimmed)) return MEDIUM;

  // Bare email line ("jane@example.com").
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(norm)) return MEDIUM;

  return 0;
}

/** Ratio of characters that live inside <a> tags within an element. */
function linkCharRatio(el: Element): { ratio: number; links: number } {
  const anchors = Array.from(el.querySelectorAll("a"));
  if (anchors.length === 0) return { ratio: 0, links: 0 };
  const total = (el.textContent ?? "").replace(/\s+/g, "").length;
  if (total === 0) return { ratio: 0, links: anchors.length };
  let linkChars = 0;
  for (const a of anchors) {
    linkChars += (a.textContent ?? "").replace(/\s+/g, "").length;
  }
  return { ratio: linkChars / total, links: anchors.length };
}

function textLen(el: Element): number {
  return (el.textContent ?? "").trim().length;
}

/**
 * TEXT-based boilerplate test for class-less blocks (Readability strips
 * class/id). A SHORT block whose normalized text matches a strong CTA phrase is
 * boilerplate regardless of attributes. Deliberately conservative: long
 * paragraphs that merely mention a phrase mid-prose are never flagged.
 */
function isTextBoilerplate(text: string): boolean {
  const norm = normalizeText(text);
  if (norm.length === 0) return false;
  if (norm.length > TEXT_BOILERPLATE_MAXLEN) return false;
  return (
    TEXT_BOILERPLATE_RE.test(norm) ||
    NEWSLETTER_CTA_CONTEXT_RE.test(norm) ||
    GET_LATEST_CTA_CONTEXT_RE.test(norm) ||
    SIGNUP_CTA_CONTEXT_RE.test(norm) ||
    SIGNUP_RESIDUE_RE.test(norm) ||
    TRAILING_PUBLICATION_CTA_RE.test(norm) ||
    ARCHIVE_LINK_RESIDUE_RE.test(norm) ||
    RECIRC_RANKED_ITEM_RE.test(norm)
  );
}

/** True when the block is empty or boilerplate by attribute OR by text. */
function isBoilerplateBlock(el: Element, text: string): boolean {
  if (text.length === 0) return true;
  if (BOILERPLATE_ATTR_RE.test(attrHaystack(el))) return true;
  return isTextBoilerplate(text);
}

/** Collect attribute-based boilerplate blocks (highest confidence). */
function collectAttrBoilerplate(root: Element, out: Candidate[]): void {
  for (const el of Array.from(root.querySelectorAll(BLOCK_SELECTOR))) {
    if (el === root) continue;
    if (BOILERPLATE_ATTR_RE.test(attrHaystack(el))) {
      out.push({ el, confidence: HIGH });
    }
  }
}

/**
 * Collect short label headings (e.g. "Related") plus the link-list block that
 * immediately follows them.
 */
function collectLabelWidgets(root: Element, out: Candidate[]): void {
  const headings = Array.from(root.querySelectorAll("h1,h2,h3,h4,h5,h6,p,strong,b"));
  for (const heading of headings) {
    const text = (heading.textContent ?? "").trim();
    if (text.length === 0 || text.length > 40) continue;
    if (!LABEL_RE.test(text)) continue;
    out.push({ el: heading, confidence: MEDIUM });
    const next = heading.nextElementSibling;
    if (next && /^(ul|ol|nav|div|section|aside)$/i.test(next.tagName)) {
      out.push({ el: next, confidence: MEDIUM });
    }
  }
}

/** Collect link-dense widgets (related/nav lists masquerading as content). */
function collectLinkDense(root: Element, out: Candidate[]): void {
  for (const el of Array.from(root.querySelectorAll("ul,ol,nav,section,div"))) {
    if (el === root) continue;
    const { ratio, links } = linkCharRatio(el);
    if (links >= 2 && ratio > 0.6) {
      out.push({ el, confidence: MEDIUM });
    }
  }
}

/**
 * Collect class-less CTA / boilerplate blocks via TEXT detection. Catches
 * residue that lost its class/id to Readability (e.g. a bare
 * `<p>Subscribe to our weekly newsletter…</p>`). Only leaf blocks are inspected
 * so we never flag a wrapper that also holds body prose.
 */
function collectTextBoilerplate(root: Element, out: Candidate[]): void {
  for (const el of Array.from(root.querySelectorAll(BLOCK_SELECTOR))) {
    if (el === root) continue;
    if (!isLeafBlock(el)) continue;
    const text = (el.textContent ?? "").trim();
    if (isTextBoilerplate(text)) {
      out.push({ el, confidence: HIGH });
    }
  }
}

function collectOrphanVideoLabels(root: Element, out: Candidate[]): void {
  for (const el of Array.from(root.querySelectorAll("p"))) {
    if (el === root) continue;
    if (!isLeafBlock(el)) continue;
    if (el.querySelector("a,img,figure,video,audio,iframe")) continue;
    const text = (el.textContent ?? "").trim();
    if (ORPHAN_VIDEO_LABEL_RE.test(text)) {
      out.push({ el, confidence: HIGH });
    }
  }
}

function collectTechnologyReviewResidue(root: Element, out: Candidate[]): void {
  for (const el of Array.from(root.querySelectorAll(BLOCK_SELECTOR))) {
    if (el === root) continue;
    if (!isLeafBlock(el)) continue;
    const text = (el.textContent ?? "").trim();
    if (text.length > 0 && text.length <= TEXT_BOILERPLATE_MAXLEN) {
      if (TECHNOLOGY_REVIEW_NEWSLETTER_ORIGIN_RE.test(normalizeText(text))) {
        out.push({ el, confidence: HIGH });
        continue;
      }
    }

    if (el.tagName.toLowerCase() !== "blockquote") continue;
    const anchors = Array.from(el.querySelectorAll("a[href]"));
    if (anchors.length !== 1) continue;
    const href = anchors[0]?.getAttribute("href") ?? "";
    let host = "";
    try {
      host = new URL(href).hostname.replace(/^www\./, "");
    } catch {
      continue;
    }
    if (!TIKTOK_HOST_RE.test(host)) continue;
    const normalizedText = normalizeText(text);
    const anchorText = normalizeText(anchors[0]?.textContent ?? "");
    if (normalizedText === anchorText || /^@[a-z0-9_.-]+$/i.test(normalizedText)) {
      out.push({ el, confidence: HIGH });
    }
  }
}

function isStandaloneImageCredit(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.length > IMAGE_CREDIT_MAXLEN) return false;
  return (
    IMAGE_CREDIT_HEADING_RE.test(trimmed) ||
    IMAGE_CREDIT_RE.test(trimmed) ||
    STANDALONE_CREDIT_LINE_RE.test(trimmed)
  );
}

function collectImageCreditBlocks(root: Element, out: Candidate[]): void {
  for (const caption of Array.from(root.querySelectorAll("figcaption"))) {
    const text = (caption.textContent ?? "").trim();
    if (isStandaloneImageCredit(text)) out.push({ el: caption, confidence: HIGH });
  }

  for (const el of Array.from(root.querySelectorAll(BLOCK_SELECTOR))) {
    if (el === root) continue;
    if (!isLeafBlock(el)) continue;
    if (el.querySelector("img,figure,video,audio,iframe,svg")) continue;
    const text = (el.textContent ?? "").trim();
    if (isStandaloneImageCredit(text)) out.push({ el, confidence: HIGH });
  }
}

function isBoilerplateImage(img: Element): boolean {
  const haystack = [
    img.getAttribute("alt"),
    img.getAttribute("src"),
    img.getAttribute("srcset"),
    img.getAttribute("data-src"),
    img.getAttribute("data-lazy-src"),
    img.getAttribute("class"),
    img.getAttribute("id"),
  ]
    .filter(Boolean)
    .join(" ");
  return IMAGE_BOILERPLATE_RE.test(haystack);
}

function collectBoilerplateImages(root: Element, out: Candidate[]): void {
  for (const img of Array.from(root.querySelectorAll("img"))) {
    if (!isBoilerplateImage(img)) continue;
    out.push({ el: img, confidence: HIGH });
    const parent = img.parentElement;
    if (!parent || parent === root) continue;
    const parentText = (parent.textContent ?? "").trim();
    const onlyBoilerplateImage =
      parentText.length === 0 &&
      parent.querySelectorAll("img,video,audio,iframe").length === 1;
    if (onlyBoilerplateImage && /^(p|figure|div)$/i.test(parent.tagName)) {
      out.push({ el: parent, confidence: HIGH });
      const prev = parent.previousElementSibling;
      const next = parent.nextElementSibling;
      if (prev?.tagName.toLowerCase() === "hr") out.push({ el: prev, confidence: HIGH });
      if (next?.tagName.toLowerCase() === "hr") out.push({ el: next, confidence: HIGH });
    }
  }
}

/**
 * Confidence that a SHORT LEADING block is a credits/author-bio line.
 *
 * Conservative by design — only fires for short blocks that either:
 *   - start with an explicit credits/byline prefix (`Credits`, `By …`), or
 *   - match the known article author name (HIGH-confidence byline hint).
 * A generic opening paragraph that merely mentions someone "is a researcher"
 * without the author hint or a credits prefix is NEVER removed.
 */
function leadingBylineConfidence(text: string, normName: string | null): number {
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.length > LEADING_BYLINE_MAXLEN) return 0;

  // Explicit leading credits / byline prefix that also reads like a bio.
  if (/^credits\b/i.test(trimmed)) return HIGH;
  if (BYLINE_PREFIX_RE.test(trimmed)) {
    return HIGH;
  }

  // Known author name appearing in a short leading bio → strong signal. Do not
  // remove an ordinary lede solely because it mentions the author's name.
  if (normName) {
    const normBody = normalizeName(trimmed);
    if (
      normBody.includes(normName) &&
      (AUTHOR_ROLE_RE.test(trimmed) ||
        /\bis the author of\b/i.test(trimmed) ||
        SOCIAL_AUTHOR_RE.test(trimmed))
    ) {
      return HIGH;
    }
  }

  return 0;
}

/** Forward-scan the first leaf blocks for a leading credits/author-bio block. */
function collectLeadingByline(
  root: Element,
  normName: string | null,
  publishedParts: { year: number; month: number; day: number } | null,
  out: Candidate[],
): void {
  const leaves = Array.from(root.querySelectorAll(BLOCK_SELECTOR)).filter(isLeafBlock);
  let expectingDateAfterAuthor = false;
  let scanned = 0;
  for (let i = 0; i < leaves.length && scanned < LEADING_SCAN; i++) {
    const el = leaves[i];
    const text = (el.textContent ?? "").trim();
    if (text.length === 0) continue; // skip empty, don't count
    scanned++;

    if (isStandaloneAuthorLine(text, normName)) {
      out.push({ el, confidence: HIGH });
      expectingDateAfterAuthor = true;
      continue;
    }

    if (expectingDateAfterAuthor && isStandaloneDateLine(text, publishedParts)) {
      out.push({ el, confidence: HIGH });
      expectingDateAfterAuthor = false;
      continue;
    }

    const conf = leadingBylineConfidence(text, normName);
    if (conf > 0) {
      out.push({ el, confidence: conf });
      continue;
    }
    // Boilerplate padding (CTA/share) may precede the real lede — skip it.
    if (isBoilerplateBlock(el, text)) continue;
    // First block of genuine opening prose → stop (never gut the real lede).
    break;
  }
}

function hasMedia(el: Element): boolean {
  return el.querySelector("img,figure,video,audio,iframe,svg") !== null;
}

function isSmithsonianAuthorAvatarBlock(el: Element, normName: string | null): boolean {
  if (!/^(p|div|figure|section)$/i.test(el.tagName)) return false;
  const text = (el.textContent ?? "").trim();
  if (text.length > 80) return false;
  const images = Array.from(el.querySelectorAll("img"));
  if (images.length !== 1 || el.querySelector("video,audio,iframe")) return false;

  const img = images[0]!;
  const src = [
    img.getAttribute("src"),
    img.getAttribute("srcset"),
    img.getAttribute("data-src"),
    img.getAttribute("data-lazy-src"),
  ]
    .filter(Boolean)
    .join(" ");
  const alt = img.getAttribute("alt") ?? "";
  const title = img.getAttribute("title") ?? "";
  const attrText = [src, alt, title].join(" ");

  if (SMITHSONIAN_AUTHOR_IMAGE_RE.test(attrText)) return true;
  if (normName && normalizeName(`${alt} ${title}`) === normName) return true;
  return false;
}

function isSmithsonianAuthorLine(text: string, normName: string | null): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.length > 180) return false;
  if (isStandaloneAuthorLine(trimmed, normName)) return true;
  if (BYLINE_PREFIX_RE.test(trimmed)) return true;
  if (!normName) return false;

  const norm = normalizeName(trimmed);
  if (!norm.startsWith(normName)) return false;
  return (
    SMITHSONIAN_BYLINE_ROLE_RE.test(trimmed) ||
    AUTHOR_ROLE_RE.test(trimmed) ||
    /\b(correspondent|writer|contributor|editor|author|reporter)\b/i.test(trimmed)
  );
}

function collectSmithsonianLeadingByline(
  root: Element,
  normName: string | null,
  publishedParts: { year: number; month: number; day: number } | null,
  out: Candidate[],
): void {
  const leaves = Array.from(root.querySelectorAll(BLOCK_SELECTOR)).filter(isLeafBlock);
  const leading = leaves
    .filter((el) => (el.textContent ?? "").trim().length > 0 || hasMedia(el))
    .slice(0, 8);

  for (let i = 0; i < leading.length; i++) {
    const el = leading[i]!;
    const text = (el.textContent ?? "").trim();
    if (
      publishedParts &&
      !hasMedia(el) &&
      isStandaloneDateLine(text, publishedParts)
    ) {
      out.push({ el, confidence: HIGH });
      continue;
    }

    const isAvatar = isSmithsonianAuthorAvatarBlock(el, normName);
    const isAuthor = isSmithsonianAuthorLine(text, normName);
    if (!isAvatar && !isAuthor) continue;

    if (isAvatar) {
      out.push({ el, confidence: HIGH });
      const next = leading[i + 1];
      if (next && isSmithsonianAuthorLine((next.textContent ?? "").trim(), normName)) {
        out.push({ el: next, confidence: HIGH });
        const date = leading[i + 2];
        if (date && isStandaloneDateLine((date.textContent ?? "").trim(), publishedParts)) {
          out.push({ el: date, confidence: HIGH });
        }
      }
      continue;
    }

    out.push({ el, confidence: HIGH });
    const prev = leading[i - 1];
    if (prev && isSmithsonianAuthorAvatarBlock(prev, normName)) {
      out.push({ el: prev, confidence: HIGH });
    }
    const next = leading[i + 1];
    if (next && isStandaloneDateLine((next.textContent ?? "").trim(), publishedParts)) {
      out.push({ el: next, confidence: HIGH });
    }
  }
}

/** Reverse-scan the trailing leaf blocks for the author byline/bio. */
function collectTrailingByline(
  root: Element,
  normName: string | null,
  out: Candidate[],
): void {
  const leaves = Array.from(root.querySelectorAll(BLOCK_SELECTOR)).filter(
    isLeafBlock,
  );
  let scanned = 0;
  for (let i = leaves.length - 1; i >= 0 && scanned < TRAILING_SCAN; i--) {
    const el = leaves[i];
    const text = (el.textContent ?? "").trim();
    if (text.length === 0) continue; // skip empty, don't count
    scanned++;
    const conf = bylineConfidence(text, normName);
    if (conf > 0) {
      out.push({ el, confidence: conf });
      continue;
    }
    // Boilerplate (CTA / newsletter / share / by-attr) can pad the tail between
    // the body and the byline — skip it so the scan still reaches the bio above.
    if (isBoilerplateBlock(el, text)) continue;
    // First substantial block of genuine body prose from the end → stop.
    if (text.length > 60) break;
  }
}

/** Remove block elements left empty (no text and no media). */
function removeEmptyBlocks(root: Element): void {
  let changed = true;
  while (changed) {
    changed = false;
    for (const el of Array.from(root.querySelectorAll(BLOCK_SELECTOR))) {
      if (el === root) continue;
      const hasText = (el.textContent ?? "").trim().length > 0;
      const hasMedia = el.querySelector("img,figure,video,audio,iframe,svg") !== null;
      if (!hasText && !hasMedia) {
        el.remove();
        changed = true;
      }
    }
  }
}

/** Drop candidates whose ancestor is also a candidate (removal is covered). */
function topLevelCandidates(candidates: Candidate[]): Candidate[] {
  return candidates.filter(
    (c) =>
      !candidates.some((other) => other.el !== c.el && other.el.contains(c.el)),
  );
}

function dedupeCandidates(candidates: Candidate[]): Candidate[] {
  const byElement = new Map<Element, Candidate>();
  for (const candidate of candidates) {
    const existing = byElement.get(candidate.el);
    if (!existing || candidate.confidence > existing.confidence) {
      byElement.set(candidate.el, candidate);
    }
  }
  return Array.from(byElement.values());
}

function sumText(candidates: Candidate[]): number {
  return candidates.reduce((acc, c) => acc + textLen(c.el), 0);
}

/**
 * Decide which candidates to actually remove, honoring the conservative guard:
 * prefer the full set, fall back to high-confidence-only, then to nothing.
 */
function selectRemovals(
  candidates: Candidate[],
  originalLen: number,
): Candidate[] {
  if (candidates.length === 0 || originalLen === 0) return [];

  const unique = dedupeCandidates(candidates);
  const full = topLevelCandidates(unique);
  if (sumText(full) <= originalLen * MAX_REMOVAL_RATIO) return full;

  const highOnly = topLevelCandidates(
    unique.filter((c) => c.confidence >= HIGH),
  );
  if (highOnly.length > 0 && sumText(highOnly) <= originalLen * MAX_REMOVAL_RATIO) {
    return highOnly;
  }
  if (
    highOnly.length > 0 &&
    originalLen - sumText(highOnly) >= MIN_REMAINING_TEXT_AFTER_HIGH_CONFIDENCE
  ) {
    return highOnly;
  }

  return [];
}

/**
 * Remove residual non-article boilerplate from already-extracted article HTML.
 * Parses with linkedom, mutates a real DOM, and serializes back to a string.
 *
 * Idempotent: `declutter(declutter(x)) === declutter(x)`.
 * Returns the input unchanged when it is empty or fails to parse.
 */
export function declutterArticleHtml(html: string, opts?: DeclutterOptions): string {
  if (typeof html !== "string" || html.trim().length === 0) return html;

  let root: Element | null = null;
  try {
    const { document } = parseHTML(
      `<div id="${WRAPPER_ID}">${html}</div>`,
    );
    root = document.getElementById(WRAPPER_ID) as Element | null;
  } catch {
    return html;
  }
  if (!root) return html;

  const originalLen = textLen(root);
  const hint = opts?.byline ?? opts?.authorName ?? null;
  const normName = hint ? normalizeName(hint) : null;
  const publishedParts = dateHintParts(opts?.publishedAt);

  const candidates: Candidate[] = [];
  collectAttrBoilerplate(root, candidates);
  collectLabelWidgets(root, candidates);
  collectLinkDense(root, candidates);
  collectBoilerplateImages(root, candidates);
  collectTextBoilerplate(root, candidates);
  collectOrphanVideoLabels(root, candidates);
  collectImageCreditBlocks(root, candidates);
  collectLeadingByline(root, normName, publishedParts, candidates);
  if (opts?.providerKey === "smithsonian") {
    collectSmithsonianLeadingByline(root, normName, publishedParts, candidates);
  }
  if (opts?.providerKey === "technologyreview") {
    collectTechnologyReviewResidue(root, candidates);
  }
  collectTrailingByline(root, normName, candidates);

  const removals = selectRemovals(candidates, originalLen);
  for (const c of removals) {
    c.el.remove();
  }

  removeEmptyBlocks(root);

  return (root.innerHTML ?? "").trim();
}
