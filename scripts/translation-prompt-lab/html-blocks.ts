/**
 * Block-aligned HTML translation for provider-db articles.
 *
 * This is the core piece that satisfies "HTML matchable" translation: it
 * reuses the SAME production splitting primitives the bilingual parallel
 * reader already relies on (`sanitizeArticleHtml`, `splitHtmlParagraphs`,
 * `articleHtmlToReaderText` from `@/lib/content-pipeline`; `alignParagraphs`
 * from `@/lib/bilingual`) rather than inventing new HTML parsing. That
 * matters for two reasons:
 *   1. It's a security boundary (`sanitizeArticleHtml`) and a stability
 *      contract (`splitHtmlParagraphs` is what `BilingualBody.tsx` already
 *      uses to slice source HTML into blocks) — re-deriving either would
 *      risk drifting from what the reader actually renders.
 *   2. The output shape (translated text, one paragraph per source HTML
 *      block, `\n\n`-joined, in source order) is EXACTLY the shape
 *      `Translation.content` already has in production (see
 *      `src/lib/translation.ts`) and exactly what `alignParagraphs` expects
 *      — so this is a drop-in value for that column, not a new format.
 *
 * Guaranteeing "matchable" (not just "usually matches"):
 * Naively asking the model to translate a multi-paragraph chunk and hoping
 * it preserves the paragraph count is NOT reliable enough for correctness at
 * batch scale (LLMs occasionally merge/split/drop paragraphs). Instead each
 * translation request numbers its input blocks with an explicit `[[n]]`
 * marker and demands the same markers back, in order; the response is
 * parsed and validated against the expected count. Any chunk that fails
 * validation is automatically retried once, then — if still wrong — repaired
 * by translating its blocks ONE AT A TIME (always exactly 1-in/1-out), so a
 * batch job self-heals instead of producing a silently misaligned article.
 */
import { articleHtmlToReaderText, sanitizeArticleHtml } from "@/lib/content-pipeline";
import { splitHtmlParagraphs } from "@/lib/bilingual";
import { CONTENT_ISOLATION_NOTICE, wrapUntrustedContent } from "@/lib/ai/input-safety";
import { chatCompleteWithRetry, type ChatMessage } from "./vllm-client";

/** ~4 chars/token heuristic, matching chunk.ts / production's chunking.ts. */
const CHARS_PER_TOKEN = 4;

export type ArticleBlock = {
  index: number;
  /** Sanitized HTML for this one block (e.g. "<p>...</p>"), never persisted. */
  html: string;
  /** Plain text extracted from `html`, the actual translation input. */
  text: string;
};

/**
 * Splits sanitized article HTML into the same block granularity the
 * bilingual reader uses, extracting each block's plain text. Blocks with no
 * extractable text (e.g. an image-only `<figure>`) are kept as empty-string
 * entries so the block COUNT (and therefore alignment) is preserved — they
 * translate to `""` rather than being dropped.
 */
export function splitArticleBlocks(sanitizedHtml: string): ArticleBlock[] {
  return splitHtmlParagraphs(sanitizedHtml).map((html, index) => ({
    index,
    html,
    text: articleHtmlToReaderText(html).trim(),
  }));
}

const MARKER_RE_SOURCE = "\\[\\[(\\d+)\\]\\]";

function markerFor(n: number): string {
  return `[[${n}]]`;
}

function buildNumberedInput(blocks: ArticleBlock[]): string {
  return blocks.map((b, i) => `${markerFor(i + 1)}\n${b.text}`).join("\n\n");
}

/**
 * Strips a preamble line the model occasionally prepends despite being told
 * not to (e.g. "Here is the translation of the provided text into Chinese:")
 * — observed directly against this deployment. Only strips a short leading
 * line with no markers in it, followed by a blank line, so this can't eat
 * real translated content.
 */
function stripPreamble(responseText: string): string {
  const match = responseText.match(/^([^\n]{0,120})\n\s*\n/);
  if (match && !/\[\[\d+\]\]/.test(match[1]!) && !/[\u4e00-\u9fff]/.test(match[1]!)) {
    return responseText.slice(match[0].length);
  }
  return responseText;
}

/**
 * Parses a `[[n]]`-marked model response into an ordered array of
 * translations, tolerating the failure modes actually observed against this
 * deployment rather than only accepting a perfectly compliant response
 * (strict compliance was measured well under 100% — see repair-rate notes
 * in `translateBatchWithRepair`). Returns `null` only when none of these
 * recovery strategies can confidently reconstruct `expectedCount` ordered
 * paragraphs; the caller then falls back to guaranteed-correct per-block
 * repair.
 *
 * Recovery tiers, in order:
 *   1. Strict: every marker 1..expectedCount present, in order.
 *   2. Missing-marker-1: markers 2..expectedCount present and the response
/**
 * Content-level sanity check applied to EVERY tier's candidate output,
 * including the strict tier-1 marker match: structural marker compliance
 * alone does NOT guarantee actual translation happened — observed directly
 * against this deployment, the model occasionally echoes markers correctly
 * around content it left entirely (or mostly) in English, which a
 * marker-only check cannot detect. A low CJK floor (well below any
 * legitimate technical article's ratio, e.g. ~0.4 for a chemistry-heavy
 * piece) reliably distinguishes "didn't translate" from "translated a
 * numeral/symbol-heavy passage".
 */
function looksTranslated(paragraphs: string[]): boolean {
  const joined = paragraphs.join("");
  const nonWhitespace = joined.replace(/\s+/g, "");
  if (nonWhitespace.length === 0) return true; // genuinely empty is handled elsewhere, not this check's job
  const cjk = nonWhitespace.match(/[\u4e00-\u9fff]/g)?.length ?? 0;
  return cjk / nonWhitespace.length >= 0.15;
}

function parseMarkedResponse(responseTextRaw: string, expectedCount: number): string[] | null {
  const responseText = stripPreamble(responseTextRaw.trim());
  const re = new RegExp(`${MARKER_RE_SOURCE}\\s*\\n([\\s\\S]*?)(?=\\n${MARKER_RE_SOURCE}|$)`, "g");
  const found = new Map<number, string>();
  let firstMarkerIndex = -1;
  for (const match of responseText.matchAll(re)) {
    if (firstMarkerIndex < 0) firstMarkerIndex = match.index ?? -1;
    const n = Number(match[1]);
    const text = match[2]?.trim() ?? "";
    found.set(n, text);
  }

  if (found.size === expectedCount) {
    const ordered: string[] = [];
    for (let n = 1; n <= expectedCount; n++) {
      const text = found.get(n);
      if (text === undefined) return null;
      ordered.push(text);
    }
    return looksTranslated(ordered) ? ordered : null;
  }

  if (found.size === expectedCount - 1 && !found.has(1) && firstMarkerIndex > 0) {
    const leading = responseText.slice(0, firstMarkerIndex).trim();
    if (leading.length > 0) {
      const ordered = [leading];
      for (let n = 2; n <= expectedCount; n++) {
        const text = found.get(n);
        if (text === undefined) return null;
        ordered.push(text);
      }
      return looksTranslated(ordered) ? ordered : null;
    }
  }

  if (found.size === 0) {
    const paragraphs = responseText
      .split(/\n{2,}/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
    if (paragraphs.length === expectedCount) return looksTranslated(paragraphs) ? paragraphs : null;
  }

  return null;
}

const MARKER_SYSTEM_NOTE =
  " The user message contains multiple numbered paragraphs, each preceded by " +
  "a marker of the exact form [[n]] on its own line (e.g. [[1]], [[2]], ...). " +
  "Translate each paragraph independently. Your reply must reproduce the SAME " +
  "markers, in the SAME order, one per translated paragraph, with no markers " +
  "added, removed, merged, or renumbered — even if a paragraph is very short " +
  "or looks like a fragment, and even for the very first paragraph (it must " +
  "start with [[1]] just like every other paragraph starts with its own " +
  "marker). Never merge two numbered paragraphs into one, and never split " +
  "one numbered paragraph into two. Do not add any introduction, preface, or " +
  "explanation such as \"Here is the translation\" — your entire reply must " +
  "start directly with [[1]] and contain nothing besides the markers and " +
  "their translations.";

function outputTokenBudget(inputCharCount: number, blockCount: number): number {
  // Headroom for marker overhead (~10 chars/block) plus the same generous
  // input-char-count-based sizing used in the lab's translate.ts.
  return Math.min(8192, Math.max(768, inputCharCount + blockCount * 16 + 256));
}

async function translateMarkedBatch(
  blocks: ArticleBlock[],
  systemPrompt: string,
  temperature: number,
): Promise<string[] | null> {
  const nonEmpty = blocks.filter((b) => b.text.length > 0);
  if (nonEmpty.length === 0) return blocks.map(() => "");
  const input = buildNumberedInput(nonEmpty);
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt + MARKER_SYSTEM_NOTE + " " + CONTENT_ISOLATION_NOTICE },
    { role: "user", content: wrapUntrustedContent(input, "article", 200_000) },
  ];
  const result = await chatCompleteWithRetry(messages, {
    temperature,
    maxTokens: outputTokenBudget(input.length, nonEmpty.length),
  });
  if (result.finishReason === "length") return null;
  const parsed = parseMarkedResponse(result.text, nonEmpty.length);
  if (!parsed) return null;
  // Re-expand to the original (possibly sparser) block list, filling empty
  // blocks back in as "" so the caller's index alignment is preserved.
  const byNonEmptyIndex = new Map(nonEmpty.map((b, i) => [b.index, parsed[i]!]));
  return blocks.map((b) => byNonEmptyIndex.get(b.index) ?? "");
}

/**
 * Translates one block alone — the guaranteed-correct repair path.
 * "Guaranteed correct" refers to alignment (always exactly 1-in/1-out), NOT
 * translation compliance, and deliberately does NOT hard-fail on a low CJK
 * ratio the way batch validation does: short/medium blocks are frequently
 * LEGITIMATELY meant to stay untranslated per `UNTRANSLATABLE_CONTENT_RULE`
 * — photo credits, bibliographic citations, and place names routinely run
 * 30-150+ chars with correctly near-zero Chinese content (e.g. "Heritage
 * Image Partnership Ltd via Alamy.", or a full citation like "Vanderwood,
 * P.J., 1992. Disorder and progress... p. 53." — both observed directly
 * against this deployment triggering false-positive rejections under an
 * earlier, stricter version of this function). Rejecting on ratio alone
 * can't distinguish that from a genuine refusal-to-translate, so instead
 * this reports a `suspicious` flag for the caller to surface as a QA flag
 * for human review rather than aborting the whole article.
 */
async function translateSingleBlock(
  block: ArticleBlock,
  systemPrompt: string,
  temperature: number,
): Promise<{ text: string; suspicious: boolean }> {
  if (!block.text) return { text: "", suspicious: false };
  const result = await chatCompleteWithRetry(
    [
      { role: "system", content: systemPrompt + " " + CONTENT_ISOLATION_NOTICE },
      { role: "user", content: wrapUntrustedContent(block.text, "article", 200_000) },
    ],
    { temperature, maxTokens: outputTokenBudget(block.text.length, 1) },
  );
  if (result.finishReason === "length") {
    throw new Error(`block ${block.index} hit the output token cap (finish_reason: length)`);
  }
  const text = result.text.trim();
  // Only worth flagging for genuinely long blocks — short blocks are where
  // legitimate untranslated content concentrates, so a ratio check there is
  // mostly noise (see the docstring above).
  const suspicious = block.text.length >= 150 && !looksTranslated([text]);
  return { text, suspicious };
}

export type BlockTranslationOutcome = {
  translations: string[];
  /** True if any chunk needed the per-block repair fallback. */
  repaired: boolean;
  /** Count of individually-repaired blocks whose translation still looked suspicious (long block, low CJK ratio) — surfaced as a QA flag, not a hard failure. */
  suspiciousBlockCount: number;
};

/**
 * Translates a batch of blocks (already sized to fit one request's input
 * budget) with the marker-validated protocol, self-healing via per-block
 * repair if marker validation fails twice.
 */
async function translateBatchWithRepair(
  blocks: ArticleBlock[],
  systemPrompt: string,
  temperature: number,
): Promise<BlockTranslationOutcome> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await translateMarkedBatch(blocks, systemPrompt, temperature);
    if (result) return { translations: result, repaired: false, suspiciousBlockCount: 0 };
  }
  // Repair path: translate each block individually — slower but guaranteed
  // 1:1, so a batch job never silently ships a misaligned article.
  const translations: string[] = [];
  let suspiciousBlockCount = 0;
  for (const block of blocks) {
    const { text, suspicious } = await translateSingleBlock(block, systemPrompt, temperature);
    translations.push(text);
    if (suspicious) suspiciousBlockCount++;
  }
  return { translations, repaired: true, suspiciousBlockCount };
}

/** Groups blocks into input-token-budgeted batches, never splitting a block. */
function batchBlocks(blocks: ArticleBlock[], maxInputTokens: number): ArticleBlock[][] {
  const maxChars = Math.max(200, maxInputTokens * CHARS_PER_TOKEN);
  const batches: ArticleBlock[][] = [];
  let current: ArticleBlock[] = [];
  let currentChars = 0;
  for (const block of blocks) {
    const blockChars = block.text.length;
    if (blockChars > maxChars) {
      // A single oversized block (rare: a huge blockquote/table cell) gets
      // its own batch; translateMarkedBatch/translateSingleBlock handle it
      // as a batch of one via the normal path — its output budget scales
      // with its own char count so it isn't truncated.
      if (current.length > 0) {
        batches.push(current);
        current = [];
        currentChars = 0;
      }
      batches.push([block]);
      continue;
    }
    if (currentChars + blockChars > maxChars && current.length > 0) {
      batches.push(current);
      current = [];
      currentChars = 0;
    }
    current.push(block);
    currentChars += blockChars;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

/**
 * `alignParagraphs`/`splitTranslationParagraphs` (`@/lib/bilingual`) split
 * translation text on blank lines and DROP empty paragraphs — an ordinary
 * `\n\n`-join of blocks that includes a real empty string (e.g. an
 * image-only `<figure>` with no caption text) collapses at that position,
 * which silently shifts the positional index of every following paragraph
 * out of alignment with its source block (confirmed empirically: a
 * 103-block article produced only 96 paragraphs after a naive join —
 * `alignParagraphs` would have mispaired the remaining ~7 paragraphs).
 * A zero-width space is not `White_Space` per Unicode, so it survives
 * `.trim()` and the `.length > 0` filter, occupying the paragraph "slot" as
 * an invisible placeholder without ever rendering visible text.
 */
const EMPTY_BLOCK_PLACEHOLDER = "\u200B";

export type ArticleTranslationResult = {
  /** `\n\n`-joined, one entry per source block, in source order — the exact
   *  shape of `Translation.content` / what `alignParagraphs` expects. */
  content: string;
  sourceBlockCount: number;
  chunkCount: number;
  repairedChunkCount: number;
  /** Individually-repaired blocks whose translation still looked suspicious (long + low CJK ratio) — surface as a QA flag for human review. */
  suspiciousBlockCount: number;
};

/**
 * Translates a full article body, guaranteeing the output has exactly
 * `sourceBlockCount` paragraphs (per `splitTranslationParagraphs`, the same
 * blank-line splitter `alignParagraphs` uses) in the same order as the
 * source HTML blocks. Long articles are split into multiple batched
 * requests (see `batchBlocks`); each batch is independently
 * marker-validated and, if needed, self-repaired (see
 * `translateBatchWithRepair`).
 */
export async function translateArticleBlocks(
  html: string,
  systemPrompt: string,
  options: { maxInputTokens?: number; temperature?: number } = {},
): Promise<ArticleTranslationResult> {
  const sanitized = sanitizeArticleHtml(html);
  const blocks = splitArticleBlocks(sanitized);
  const maxInputTokens = options.maxInputTokens ?? 1500;
  const temperature = options.temperature ?? 0.2;
  const batches = batchBlocks(blocks, maxInputTokens);

  const translationsByIndex = new Map<number, string>();
  let repairedChunkCount = 0;
  let suspiciousBlockCount = 0;
  for (const batch of batches) {
    const { translations, repaired, suspiciousBlockCount: batchSuspicious } = await translateBatchWithRepair(
      batch,
      systemPrompt,
      temperature,
    );
    if (repaired) repairedChunkCount++;
    suspiciousBlockCount += batchSuspicious;
    batch.forEach((block, i) => translationsByIndex.set(block.index, translations[i] ?? ""));
  }

  // A single source block must never contribute more than one paragraph to
  // the joined output — collapse any blank line the model inserted WITHIN
  // one block's own translated text down to a single newline. Without this,
  // one block's translation containing an internal blank line silently
  // produces an EXTRA paragraph after the final \n\n-join, over-counting
  // against `sourceBlockCount` just as surely as a dropped block
  // under-counts it (observed directly: a 119-block article produced 123
  // paragraphs from a single "successfully" marker-validated batch).
  const ordered = blocks.map((b) => {
    const text = translationsByIndex.get(b.index)?.trim().replace(/\n{2,}/g, "\n") ?? "";
    return text || EMPTY_BLOCK_PLACEHOLDER;
  });
  return {
    content: ordered.join("\n\n"),
    sourceBlockCount: blocks.length,
    chunkCount: batches.length,
    repairedChunkCount,
    suspiciousBlockCount,
  };
}
