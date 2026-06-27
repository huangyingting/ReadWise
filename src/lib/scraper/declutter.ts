/**
 * Declutter pass — removes non-article boilerplate that a generic extractor
 * (Readability / @extractus) leaves behind in already-extracted article HTML.
 *
 * This runs AFTER body extraction and BEFORE sanitize. It targets residue that
 * structural extractors miss:
 *   1. the trailing author byline/bio paragraph at the bottom of the article,
 *   2. related / newsletter / share / comments boilerplate blocks,
 *   3. high-link-density widgets (related/nav lists masquerading as prose).
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
  /^(related(\s+(articles|stories|posts|reading|content))?|more\s+(from|stories|in|on|articles)|read\s+(more|next)|recommended(\s+for\s+you)?|you\s+(may|might)\s+also\s+(like|enjoy|read)|up\s+next|newsletter|subscribe|sign\s?up|share\s+this(\s+article)?|follow\s+us(\s+on)?|comments?|trending|sponsored|advert(isement)?|around\s+the\s+web|from\s+around\s+the\s+web|most\s+(popular|read)|in\s+this\s+series)\b/i;

const HIGH = 2;
const MEDIUM = 1;

const WRAPPER_ID = "__rw_declutter_root__";

/** How many trailing leaf blocks to scan when hunting the author byline. */
const TRAILING_SCAN = 6;
/** Fraction of original text above which aggressive removals are aborted. */
const MAX_REMOVAL_RATIO = 0.35;

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
    if (normName.length > 0 && normBody.includes(normName)) return HIGH;
  }

  // "By Jane Doe", "Words by …", "Written by …" at the very start.
  if (
    /^(by|words by|written by|story by|reported by|photographs? by|illustrations? by|edited by|reporting by)\s+[\p{Lu}@]/u.test(
      trimmed,
    )
  ) {
    return MEDIUM;
  }

  // "Jane is a senior writer at Example", "She is the author of …".
  if (
    /\b(?:[\p{Lu}][\p{Ll}]+|he|she|they)\s+(?:is|was)\s+(?:a|an|the)\s+(?:senior\s+|staff\s+|freelance\s+|contributing\s+|former\s+|award-winning\s+)*(?:writer|journalist|reporter|editor|contributor|columnist|correspondent|author|blogger|essayist|critic|broadcaster|producer)\b/u.test(
      trimmed,
    )
  ) {
    return MEDIUM;
  }
  if (/\bis the author of\b/i.test(trimmed)) return MEDIUM;

  // Social handles / follow CTAs / profile links.
  if (
    /(^|\s)@[a-z0-9_]{2,}\b/i.test(trimmed) ||
    /\bfollow\s+(me|us|her|him|them|@)/i.test(trimmed) ||
    /\b(twitter|x|instagram|threads|mastodon|facebook|bluesky|linkedin)\.com\//i.test(
      trimmed,
    ) ||
    /\bfind\s+(me|her|him|them)\s+on\b/i.test(trimmed)
  ) {
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
    // First substantial non-byline block from the end → we've reached the body.
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

  const full = topLevelCandidates(candidates);
  if (sumText(full) <= originalLen * MAX_REMOVAL_RATIO) return full;

  const highOnly = topLevelCandidates(
    candidates.filter((c) => c.confidence >= HIGH),
  );
  if (highOnly.length > 0 && sumText(highOnly) <= originalLen * MAX_REMOVAL_RATIO) {
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

  const candidates: Candidate[] = [];
  collectAttrBoilerplate(root, candidates);
  collectLabelWidgets(root, candidates);
  collectLinkDense(root, candidates);
  collectTrailingByline(root, normName, candidates);

  const removals = selectRemovals(candidates, originalLen);
  for (const c of removals) {
    c.el.remove();
  }

  removeEmptyBlocks(root);

  return (root.innerHTML ?? "").trim();
}
