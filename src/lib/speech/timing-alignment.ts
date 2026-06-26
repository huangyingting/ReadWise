/**
 * Banded sequence-alignment algorithm for TTS word timings.
 *
 * Aligns Azure Speech word-timing entries to reader text tokens so that each
 * timing entry maps to a contiguous token span.  Extracted from
 * `speech-timing.ts` to keep this self-contained algorithm reviewable
 * independently of the tokenisation helpers in `./timing`.
 */
import {
  type ComparableToken,
  createAlphanumericKey,
  extractSpeechBoundaryTokens,
} from "./timing";

const ALIGNMENT_BAND_RADIUS = 512;

type TimingPiece = {
  wordIndex: number;
  normalized: string;
  required: boolean;
};

function boundaryKeysMatch(timingKey: string, tokenKey: string): boolean {
  if (timingKey === tokenKey) return true;

  const timingAlpha = createAlphanumericKey(timingKey);
  const tokenAlpha = createAlphanumericKey(tokenKey);
  if (!timingAlpha || !tokenAlpha) return false;

  // Possessive tolerance in both directions:
  // TTS "Japan" <-> text "Japan's", and TTS "China's" <-> text "China".
  return (
    (tokenAlpha.endsWith("s") && tokenAlpha === `${timingAlpha}s`) ||
    (timingAlpha.endsWith("s") && timingAlpha === `${tokenAlpha}s`)
  );
}

function expandTimingPieces(wordTimings: Array<{ word: string }>): {
  pieces: TimingPiece[];
  requiredCounts: number[];
} {
  const pieces: TimingPiece[] = [];
  const requiredCounts = new Array<number>(wordTimings.length).fill(0);

  for (let wordIndex = 0; wordIndex < wordTimings.length; wordIndex++) {
    const timingWord = wordTimings[wordIndex]?.word ?? "";
    if (!timingWord.trim()) continue;

    const boundaries = extractSpeechBoundaryTokens(timingWord).filter((token) => token.normalized);
    const hasAlphanumericBoundary = boundaries.some((token) => createAlphanumericKey(token.value));

    for (const boundary of boundaries) {
      const isAlphanumeric = Boolean(createAlphanumericKey(boundary.value));
      // For mixed word boundaries like `Character.AI`, punctuation is useful if
      // it matches the reader text, but the alphanumeric pieces are sufficient
      // to anchor the timing when the reader tokenization omits punctuation.
      // For punctuation-only boundaries like `...`, every piece is required.
      const required = hasAlphanumericBoundary ? isAlphanumeric : true;
      pieces.push({ wordIndex, normalized: boundary.normalized, required });
      if (required) requiredCounts[wordIndex]++;
    }
  }

  return { pieces, requiredCounts };
}

function bandCenter(row: number, rows: number, columns: number): number {
  return rows === 0 ? 0 : Math.round((row * columns) / rows);
}

function bandStart(row: number, rows: number, columns: number, radius: number): number {
  return Math.max(0, bandCenter(row, rows, columns) - radius);
}

function bandEnd(row: number, rows: number, columns: number, radius: number): number {
  return Math.min(columns, bandCenter(row, rows, columns) + radius);
}

type MatchState = {
  pieceIndex: number;
  tokenIndex: number;
  length: number;
  previous: number;
};

function isBetterState(states: MatchState[], candidateIndex: number, currentIndex: number): boolean {
  if (candidateIndex < 0) return false;
  if (currentIndex < 0) return true;

  const candidate = states[candidateIndex];
  const current = states[currentIndex];
  if (!candidate) return false;
  if (!current) return true;

  if (candidate.length !== current.length) return candidate.length > current.length;
  if (candidate.tokenIndex !== current.tokenIndex) return candidate.tokenIndex > current.tokenIndex;
  if (candidate.pieceIndex !== current.pieceIndex) return candidate.pieceIndex > current.pieceIndex;
  return candidateIndex > currentIndex;
}

function isBetterCandidate(
  states: MatchState[],
  candidate: MatchState,
  currentIndex: number,
): boolean {
  if (currentIndex < 0) return true;

  const current = states[currentIndex];
  if (!current) return true;

  if (candidate.length !== current.length) return candidate.length > current.length;
  if (candidate.tokenIndex !== current.tokenIndex) return candidate.tokenIndex > current.tokenIndex;
  if (candidate.pieceIndex !== current.pieceIndex) return candidate.pieceIndex > current.pieceIndex;
  return isBetterState(states, candidate.previous, current.previous);
}

function queryBestState(tree: Int32Array, states: MatchState[], exclusiveTokenIndex: number): number {
  let index = exclusiveTokenIndex;
  let best = -1;

  while (index > 0) {
    const stateIndex = tree[index] ?? -1;
    if (isBetterState(states, stateIndex, best)) best = stateIndex;
    index -= index & -index;
  }

  return best;
}

function updateBestState(tree: Int32Array, states: MatchState[], tokenIndex: number, stateIndex: number): void {
  let index = tokenIndex + 1;

  while (index < tree.length) {
    if (isBetterState(states, stateIndex, tree[index] ?? -1)) {
      tree[index] = stateIndex;
    }
    index += index & -index;
  }
}

function tokenKeysForTimingPiece(normalized: string): string[] {
  const keys = new Set<string>();
  if (normalized) keys.add(normalized);

  const alpha = createAlphanumericKey(normalized);
  if (alpha) {
    keys.add(alpha);
    keys.add(`${alpha}s`);
    if (alpha.endsWith("s") && alpha.length > 1) {
      keys.add(alpha.slice(0, -1));
    }
  }

  return [...keys];
}

function isInsideAlignmentBand(
  pieceIndex: number,
  tokenIndex: number,
  rows: number,
  columns: number,
  radius: number,
): boolean {
  const row = pieceIndex + 1;
  const column = tokenIndex + 1;
  return column >= bandStart(row, rows, columns, radius) && column <= bandEnd(row, rows, columns, radius);
}

function matchingTokenIndexes(
  piece: TimingPiece,
  pieceIndex: number,
  tokens: ComparableToken[],
  tokenIndexesByKey: Map<string, number[]>,
  rows: number,
  columns: number,
  radius: number,
): number[] {
  const keys = tokenKeysForTimingPiece(piece.normalized);
  if (keys.length === 0) return [];

  if (keys.length === 1) {
    const indexes = tokenIndexesByKey.get(keys[0] ?? "") ?? [];
    const result: number[] = [];
    for (let index = indexes.length - 1; index >= 0; index--) {
      const tokenIndex = indexes[index] ?? -1;
      const token = tokens[tokenIndex];
      if (
        token &&
        isInsideAlignmentBand(pieceIndex, tokenIndex, rows, columns, radius) &&
        boundaryKeysMatch(piece.normalized, token.normalized)
      ) {
        result.push(tokenIndex);
      }
    }
    return result;
  }

  const seen = new Set<number>();
  for (const key of keys) {
    const indexes = tokenIndexesByKey.get(key) ?? [];
    for (const tokenIndex of indexes) {
      if (seen.has(tokenIndex)) continue;
      const token = tokens[tokenIndex];
      if (
        token &&
        isInsideAlignmentBand(pieceIndex, tokenIndex, rows, columns, radius) &&
        boundaryKeysMatch(piece.normalized, token.normalized)
      ) {
        seen.add(tokenIndex);
      }
    }
  }

  return [...seen].sort((left, right) => right - left);
}

function buildBandedBoundaryPairs(
  pieces: TimingPiece[],
  tokens: ComparableToken[],
): Array<[number, number]> {
  const rows = pieces.length;
  const columns = tokens.length;
  if (rows === 0 || columns === 0) return [];

  const radius = Math.max(ALIGNMENT_BAND_RADIUS, Math.abs(rows - columns) + 64);

  const tokenIndexesByKey = new Map<string, number[]>();
  for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex++) {
    const token = tokens[tokenIndex];
    if (!token?.normalized) continue;
    const indexes = tokenIndexesByKey.get(token.normalized) ?? [];
    indexes.push(tokenIndex);
    tokenIndexesByKey.set(token.normalized, indexes);
  }

  const tree = new Int32Array(columns + 1);
  tree.fill(-1);
  const bestStateByToken = new Int32Array(columns);
  bestStateByToken.fill(-1);
  const states: MatchState[] = [];

  for (let pieceIndex = 0; pieceIndex < pieces.length; pieceIndex++) {
    const piece = pieces[pieceIndex];
    if (!piece?.normalized) continue;

    for (const tokenIndex of matchingTokenIndexes(
      piece,
      pieceIndex,
      tokens,
      tokenIndexesByKey,
      rows,
      columns,
      radius,
    )) {
      const previous = queryBestState(tree, states, tokenIndex);
      const candidate: MatchState = {
        pieceIndex,
        tokenIndex,
        length: (previous >= 0 ? states[previous]?.length ?? 0 : 0) + 1,
        previous,
      };

      if (!isBetterCandidate(states, candidate, bestStateByToken[tokenIndex] ?? -1)) {
        continue;
      }

      const stateIndex = states.length;
      states.push(candidate);
      bestStateByToken[tokenIndex] = stateIndex;
      updateBestState(tree, states, tokenIndex, stateIndex);
    }
  }

  let stateIndex = queryBestState(tree, states, columns);
  const pairs: Array<[number, number]> = [];

  while (stateIndex >= 0) {
    const state = states[stateIndex];
    if (!state) break;
    pairs.push([state.pieceIndex, state.tokenIndex]);
    stateIndex = state.previous;
  }

  return pairs.reverse();
}

/**
 * Builds a forward-only alignment from TTS timing entries to source text
 * tokens. A single timing entry may map to a token span because Azure can emit
 * compact boundaries (for example `Character.AI` or `...`) while the reader
 * exposes those as adjacent speech-boundary tokens.
 */
export function buildTokenAlignment(
  tokens: ComparableToken[],
  wordTimings: Array<{ word: string }>,
): { alignment: Array<number | null>; spanLengths: number[] } {
  const alignment: Array<number | null> = new Array(wordTimings.length).fill(null);
  const spanLengths: number[] = new Array(wordTimings.length).fill(1);

  if (!tokens.length || !wordTimings.length) {
    return { alignment, spanLengths };
  }

  const { pieces, requiredCounts } = expandTimingPieces(wordTimings);
  if (pieces.length === 0) {
    return { alignment, spanLengths };
  }

  const matchedTokenIndexesByWord = new Map<number, number[]>();
  const matchedRequiredCounts = new Array<number>(wordTimings.length).fill(0);

  for (const [pieceIndex, tokenIndex] of buildBandedBoundaryPairs(pieces, tokens)) {
    const piece = pieces[pieceIndex];
    if (!piece) continue;

    const list = matchedTokenIndexesByWord.get(piece.wordIndex) ?? [];
    list.push(tokenIndex);
    matchedTokenIndexesByWord.set(piece.wordIndex, list);

    if (piece.required) matchedRequiredCounts[piece.wordIndex]++;
  }

  for (const [wordIndex, tokenIndexes] of matchedTokenIndexesByWord.entries()) {
    const requiredCount = requiredCounts[wordIndex] ?? 0;
    if (requiredCount === 0 || matchedRequiredCounts[wordIndex] < requiredCount) continue;

    const first = Math.min(...tokenIndexes);
    const last = Math.max(...tokenIndexes);
    alignment[wordIndex] = first;
    spanLengths[wordIndex] = Math.max(1, last - first + 1);
  }

  return { alignment, spanLengths };
}
