/**
 * Long-text chunking & context management for AI workflows (RW-025).
 *
 * Long articles can exceed a model's context window or degrade output quality
 * when sent as one giant prompt. This module provides token-aware, dependency
 * free utilities to keep prompts bounded and to pick the right context strategy
 * per feature:
 *
 *   - {@link estimateTokens} — cheap chars≈4 heuristic (no tokenizer dependency).
 *   - {@link chunkText} — splits text into overlapping, token-bounded chunks on
 *     sentence/word boundaries, never exceeding the cap.
 *   - {@link boundedSampleForFeature} — a representative, token-bounded sample
 *     for features that don't need the full text (difficulty/tags/vocab/quiz).
 *   - {@link chunkForFeature} — full-coverage chunking for features that must
 *     process the whole article (translation).
 *   - {@link hashContent} / {@link promptVersionFor} — content-version + prompt
 *     version dimensions so caches can key on "which text / which prompt".
 *
 * Budgets are expressed in tokens and clamped to the active provider's context
 * window (see {@link import("@/lib/config").aiMaxContextTokens}).
 */
import { createHash } from "crypto";
import { aiMaxContextTokens } from "@/lib/config";
import { activePromptVersion, PROMPT_FEATURES } from "@/lib/ai/prompts";

/** Average characters per token for the heuristic estimator (no tokenizer). */
const CHARS_PER_TOKEN = 4;

/**
 * Cheap, monotonic token estimate for a string. Deliberately an over-estimate
 * for safety margin. `estimateTokens(a) <= estimateTokens(a + b)` always holds.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/** Converts a token budget to an approximate character budget. */
export function tokensToChars(tokens: number): number {
  return Math.max(0, Math.floor(tokens * CHARS_PER_TOKEN));
}

/** Per-feature context strategy. */
export type ContextStrategy = "sample" | "chunk-full";

export type FeatureContext = {
  /** Max input tokens to spend on article context for this feature. */
  maxInputTokens: number;
  /** Whether the feature samples a bounded prefix or covers the full text. */
  strategy: ContextStrategy;
  /** Overlap (tokens) between consecutive chunks for chunk-full features. */
  chunkOverlapTokens: number;
};

/**
 * Per-feature input budgets. Values mirror the previous character caps
 * (chars≈4·tokens) so existing single-call features keep their behaviour, while
 * translation gains full-text coverage via chunking. All budgets are further
 * clamped to the provider's context window at call time.
 */
export const FEATURE_CONTEXT: Record<string, FeatureContext> = {
  // ~8000 chars
  translation: { maxInputTokens: 1500, strategy: "chunk-full", chunkOverlapTokens: 120 },
  vocabulary: { maxInputTokens: 2000, strategy: "sample", chunkOverlapTokens: 0 },
  quiz: { maxInputTokens: 2000, strategy: "sample", chunkOverlapTokens: 0 },
  // ~6000 chars
  tags: { maxInputTokens: 1500, strategy: "sample", chunkOverlapTokens: 0 },
  difficulty: { maxInputTokens: 1500, strategy: "sample", chunkOverlapTokens: 0 },
  // ~7000 chars
  tutor: { maxInputTokens: 1750, strategy: "sample", chunkOverlapTokens: 0 },
};

const DEFAULT_FEATURE_CONTEXT: FeatureContext = {
  maxInputTokens: 1500,
  strategy: "sample",
  chunkOverlapTokens: 0,
};

/** Returns the context strategy for a feature (with sensible defaults). */
export function featureContext(feature: string): FeatureContext {
  return FEATURE_CONTEXT[feature] ?? DEFAULT_FEATURE_CONTEXT;
}

/**
 * Resolves the effective input-token budget for a feature, clamped so it leaves
 * room for the prompt scaffolding + completion inside the model context window.
 */
export function resolveInputBudget(feature: string, maxContextTokens?: number): number {
  const ctx = featureContext(feature);
  const modelMax = maxContextTokens ?? safeModelContextTokens();
  // Reserve ~25% of the window for the system prompt + completion.
  const usable = Math.floor(modelMax * 0.75);
  return Math.max(1, Math.min(ctx.maxInputTokens, usable));
}

/** Reads the active model's context window, defaulting defensively. */
function safeModelContextTokens(): number {
  try {
    return aiMaxContextTokens();
  } catch {
    return 128_000;
  }
}

/**
 * Returns a representative, token-bounded sample of `text` for features that do
 * not need full coverage (difficulty, tags, vocabulary, quiz). Currently a
 * leading slice — the most information-dense region of a news article — clamped
 * to the feature's budget and the model context window.
 */
export function boundedSampleForFeature(
  text: string,
  feature: string,
  maxContextTokens?: number,
): string {
  const budget = resolveInputBudget(feature, maxContextTokens);
  return clampToTokens(text, budget);
}

/** Truncates text to at most `maxTokens` worth of characters (on a boundary). */
export function clampToTokens(text: string, maxTokens: number): string {
  if (estimateTokens(text) <= maxTokens) return text;
  const maxChars = tokensToChars(maxTokens);
  if (maxChars >= text.length) return text;
  const slice = text.slice(0, maxChars);
  // Prefer to cut on the last whitespace so we don't split a word.
  const lastSpace = slice.lastIndexOf(" ");
  return (lastSpace > maxChars * 0.6 ? slice.slice(0, lastSpace) : slice).trim();
}

/**
 * Full-coverage chunking for a feature that must process the whole article
 * (translation). Returns ordered chunks, each within the feature's per-call
 * budget, with overlap so context isn't lost at boundaries. Together the chunks
 * cover every sentence of the input.
 */
export function chunkForFeature(
  text: string,
  feature: string,
  maxContextTokens?: number,
): string[] {
  const ctx = featureContext(feature);
  const budget = resolveInputBudget(feature, maxContextTokens);
  return chunkText(text, budget, ctx.chunkOverlapTokens);
}

/**
 * Splits `text` into ordered chunks that never exceed `maxTokens` (by estimate),
 * overlapping consecutive chunks by up to `overlapTokens` to preserve context.
 * Splitting prefers sentence boundaries, then words, then a hard character split
 * for pathological inputs. Empty/whitespace input yields `[]`.
 */
export function chunkText(text: string, maxTokens: number, overlapTokens = 0): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (maxTokens <= 0 || estimateTokens(trimmed) <= maxTokens) return [trimmed];

  const overlap = Math.max(0, Math.min(overlapTokens, maxTokens - 1));
  // Cap each segment so an overlap prefix + one segment still fits the budget.
  const segLimit = Math.max(1, maxTokens - overlap);
  const segments = splitIntoSegments(trimmed, segLimit);

  const chunks: string[] = [];
  let current: string[] = [];
  let currentTokens = 0;

  for (const seg of segments) {
    const segTokens = estimateTokens(seg);
    if (currentTokens + segTokens > maxTokens && current.length > 0) {
      chunks.push(current.join(" "));
      const carry = overlap > 0 ? trailingForOverlap(current, overlap) : [];
      current = [...carry];
      currentTokens = current.reduce((sum, s) => sum + estimateTokens(s), 0);
    }
    current.push(seg);
    currentTokens += segTokens;
  }
  if (current.length > 0) chunks.push(current.join(" "));
  return chunks;
}

/** Splits text into sentence-sized segments, each at most `limit` tokens. */
function splitIntoSegments(text: string, limit: number): string[] {
  const sentences = text.match(/[^.!?]+[.!?]*\s*/g) ?? [text];
  const out: string[] = [];
  for (const raw of sentences) {
    const sentence = raw.trim();
    if (!sentence) continue;
    if (estimateTokens(sentence) <= limit) {
      out.push(sentence);
      continue;
    }
    // Sentence too long: fall back to word-level packing.
    for (const piece of packWords(sentence, limit)) out.push(piece);
  }
  return out;
}

/** Packs words into pieces of at most `limit` tokens, hard-splitting long words. */
function packWords(text: string, limit: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const maxChars = tokensToChars(limit);
  const out: string[] = [];
  let buf = "";
  for (const word of words) {
    const token = word.length > maxChars ? hardSplit(word, maxChars) : [word];
    for (const w of token) {
      const candidate = buf ? `${buf} ${w}` : w;
      if (estimateTokens(candidate) > limit && buf) {
        out.push(buf);
        buf = w;
      } else {
        buf = candidate;
      }
    }
  }
  if (buf) out.push(buf);
  return out;
}

/** Hard-splits an oversized token into fixed-length character pieces. */
function hardSplit(word: string, maxChars: number): string[] {
  const pieces: string[] = [];
  for (let i = 0; i < word.length; i += maxChars) {
    pieces.push(word.slice(i, i + maxChars));
  }
  return pieces;
}

/** Returns trailing segments whose combined tokens stay within `overlap`. */
function trailingForOverlap(segments: string[], overlap: number): string[] {
  const carry: string[] = [];
  let tokens = 0;
  for (let i = segments.length - 1; i >= 0; i--) {
    const segTokens = estimateTokens(segments[i]);
    if (tokens + segTokens > overlap) break;
    carry.unshift(segments[i]);
    tokens += segTokens;
  }
  return carry;
}

// ---------------------------------------------------------------------------
// Cache-key dimensions: content version + prompt version (RW-025)
// ---------------------------------------------------------------------------

/**
 * Stable short content hash used as a cache-version dimension. Two articles with
 * identical source text share a hash; an edit changes it, so derived caches can
 * include it in their key to avoid serving stale AI output for changed content.
 */
export function hashContent(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex").slice(0, 16);
}

/**
 * Per-feature prompt version, derived from the versioned prompt registry
 * (RW-020, {@link import("@/lib/ai/prompts").PROMPT_TEMPLATES}). Bump a
 * feature's active template version there so the invocation ledger (and any
 * content-versioned cache) can distinguish outputs produced by different prompt
 * revisions. Kept as a map for backwards compatibility with earlier callers.
 */
export const PROMPT_VERSIONS: Record<string, string> = Object.fromEntries(
  PROMPT_FEATURES.map((feature) => [feature, activePromptVersion(feature)]),
);

/** Returns the prompt version label for a feature (or a `<feature>/v1` default). */
export function promptVersionFor(feature: string): string {
  return activePromptVersion(feature);
}

/**
 * Builds a deterministic cache key that folds in content + prompt versions, so
 * "repeated small interactions" over unchanged content reuse the same key while
 * an article edit or prompt bump produces a fresh one.
 */
export function aiContentCacheKey(
  feature: string,
  scope: string,
  content: string,
): string {
  return `${promptVersionFor(feature)}:${scope}:${hashContent(content)}`;
}
