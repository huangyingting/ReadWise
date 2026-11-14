/**
 * Sentence chunking and neural word-timestamp alignment for on-device
 * narration. Ported verbatim from huangyingting/neural-readalong
 * (`src/lib/word-timestamps.ts`, Apache-2.0); only the type import changed.
 */
import type {
  ChunkAlignment,
  TextChunkSpan,
  TextSegment,
  WordTimestamp,
  WordTokenSpan,
} from "./types";

const ABBREVIATIONS = new Set([
  "mr",
  "mrs",
  "ms",
  "dr",
  "prof",
  "sr",
  "jr",
  "sgt",
  "col",
  "gen",
  "rep",
  "sen",
  "gov",
  "lt",
  "maj",
  "capt",
  "st",
  "mt",
  "etc",
  "co",
  "inc",
  "ltd",
  "dept",
  "vs",
  "p",
  "pg",
  "jan",
  "feb",
  "mar",
  "apr",
  "jun",
  "jul",
  "aug",
  "sep",
  "sept",
  "oct",
  "nov",
  "dec",
  "sun",
  "mon",
  "tu",
  "tue",
  "tues",
  "wed",
  "th",
  "thu",
  "thur",
  "thurs",
  "fri",
  "sat",
]);

function isSentenceTerminator(c: string, includeNewlines = true): boolean {
  return ".!?…。？！।॥".includes(c) || (includeNewlines && c === "\n");
}

function isTrailingChar(c: string): boolean {
  return "\"'”’)]}»」』".includes(c);
}

function isAbbreviation(token: string): boolean {
  const cleaned = token.replace(/['’]s$/i, "").replace(/\.+$/, "");
  return ABBREVIATIONS.has(cleaned.toLowerCase());
}

/**
 * Segments source text into alternating word and whitespace tokens using the exact same
 * `/\s/` boundary semantics as `buildWordAlignmentData`, preserving UTF-16 character spans
 * so every word in the rendered reader maps 1-to-1 to streamed `WordTimestamp` entries.
 */
export function segmentTextIntoWords(text: string): {
  segments: TextSegment[];
  wordCount: number;
} {
  const segments: TextSegment[] = [];
  if (!text) {
    return { segments, wordCount: 0 };
  }

  let wordCount = 0;
  let i = 0;
  while (i < text.length) {
    const isSpace = /\s/.test(text[i]);
    let j = i + 1;
    while (j < text.length && /\s/.test(text[j]) === isSpace) {
      j++;
    }
    if (isSpace) {
      segments.push({
        type: "whitespace",
        text: text.slice(i, j),
        charStart: i,
        charEnd: j,
      });
    } else {
      segments.push({
        type: "word",
        text: text.slice(i, j),
        charStart: i,
        charEnd: j,
        wordIndex: wordCount++,
      });
    }
    i = j;
  }

  return { segments, wordCount };
}

function pushTrimmedSpan(
  spans: TextChunkSpan[],
  source: string,
  rawStart: number,
  rawEnd: number,
): void {
  let start = rawStart;
  let end = rawEnd;
  while (start < end && /\s/.test(source[start])) {
    start++;
  }
  while (end > start && /\s/.test(source[end - 1])) {
    end--;
  }
  if (start < end) {
    spans.push({
      text: source.slice(start, end),
      charStart: start,
      charEnd: end,
    });
  }
}

/**
 * Splits a single long span on clause punctuation (`,`, `;`, `:`, `—`) followed by whitespace,
 * and falls back to whitespace word boundaries if a clause still exceeds `maxChunkLength`.
 * Always splits strictly on whitespace so words are never broken across chunks and exact
 * substrings of `source` are preserved.
 */
function splitLongSpanWithOffsets(
  source: string,
  spanStart: number,
  spanEnd: number,
  maxChunkLength: number,
): TextChunkSpan[] {
  const results: TextChunkSpan[] = [];

  let cursor = spanStart;
  while (cursor < spanEnd) {
    while (cursor < spanEnd && /\s/.test(source[cursor])) {
      cursor++;
    }
    if (cursor >= spanEnd) break;

    if (spanEnd - cursor <= maxChunkLength) {
      pushTrimmedSpan(results, source, cursor, spanEnd);
      break;
    }

    const limit = Math.min(spanEnd, cursor + maxChunkLength);

    // Prefer splitting after a clause delimiter (comma, semicolon, colon, em-dash) + whitespace
    let splitAt = -1;
    for (let k = limit; k > cursor; k--) {
      if (/\s/.test(source[k]) && /[,;:—]/.test(source[k - 1])) {
        splitAt = k;
        break;
      }
    }

    // Otherwise split at the last whitespace before `limit`
    if (splitAt === -1) {
      for (let k = limit; k > cursor; k--) {
        if (/\s/.test(source[k])) {
          splitAt = k;
          break;
        }
      }
    }

    // If a single contiguous token exceeds `maxChunkLength`, extend to the next whitespace
    // so word boundaries stay intact unless there is no whitespace at all.
    if (splitAt === -1) {
      let nextSpace = limit;
      while (nextSpace < spanEnd && !/\s/.test(source[nextSpace])) {
        nextSpace++;
      }
      splitAt = nextSpace;
    }

    pushTrimmedSpan(results, source, cursor, splitAt);
    cursor = splitAt;
  }

  return results;
}

/**
 * Splits text sentence-by-sentence (matching `kokoro-js` streaming granularity so character-duration
 * word timestamp approximation stays tightly bounded per sentence, as described by Ryan Welch) while
 * preserving exact `[charStart, charEnd)` offsets in the original text.
 */
export function splitTextWithOffsets(
  text: string,
  maxChunkLength = 280,
): TextChunkSpan[] {
  const sentenceSpans: TextChunkSpan[] = [];
  const len = text.length;
  let sentenceStart = 0;
  let i = 0;

  while (i < len) {
    const c = text[i];

    if (isSentenceTerminator(c)) {
      const currentSegment = text.slice(sentenceStart, i);
      // Avoid splitting numbered list prefixes like "1." at start of line
      if (/(^|\n)\s*\d+$/.test(currentSegment) && c === ".") {
        i++;
        continue;
      }

      let boundaryEnd = i;
      if (c !== "\n") {
        while (
          boundaryEnd + 1 < len &&
          isSentenceTerminator(text[boundaryEnd + 1], false)
        ) {
          boundaryEnd++;
        }
        while (boundaryEnd + 1 < len && isTrailingChar(text[boundaryEnd + 1])) {
          boundaryEnd++;
        }
      }

      let nextNonSpace = boundaryEnd + 1;
      while (nextNonSpace < len && /\s/.test(text[nextNonSpace])) {
        nextNonSpace++;
      }

      // Skip mid-token periods like "$9.99" or "3.14"
      if (c !== "\n" && boundaryEnd + 1 === nextNonSpace && nextNonSpace < len) {
        i++;
        continue;
      }

      if (c !== "\n") {
        let tokenStart = i - 1;
        while (tokenStart >= sentenceStart && /\S/.test(text[tokenStart])) {
          tokenStart--;
        }
        tokenStart = Math.max(sentenceStart, tokenStart + 1);
        let tokenEnd = tokenStart;
        while (tokenEnd < len && /\S/.test(text[tokenEnd])) {
          tokenEnd++;
        }
        const token = text.slice(tokenStart, tokenEnd).replace(/^["'“‘(]+/, "");

        if (isAbbreviation(token)) {
          i++;
          continue;
        }

        if (
          /^([A-Za-z]\.)+$/.test(token) &&
          nextNonSpace < len &&
          /[A-Z]/.test(text[nextNonSpace])
        ) {
          i++;
          continue;
        }

        if (
          c === "." &&
          nextNonSpace < len &&
          /[a-z]/.test(text[nextNonSpace])
        ) {
          i++;
          continue;
        }
      }

      const candidate = text.slice(sentenceStart, boundaryEnd + 1).trim();
      if (candidate === "..." || candidate === "…") {
        i++;
        continue;
      }

      pushTrimmedSpan(sentenceSpans, text, sentenceStart, boundaryEnd + 1);
      sentenceStart = boundaryEnd + 1;
      i = sentenceStart;
      continue;
    }

    i++;
  }

  if (sentenceStart < len) {
    pushTrimmedSpan(sentenceSpans, text, sentenceStart, len);
  }

  const finalChunks: TextChunkSpan[] = [];
  for (const span of sentenceSpans) {
    if (span.text.length <= maxChunkLength) {
      finalChunks.push(span);
    } else {
      finalChunks.push(
        ...splitLongSpanWithOffsets(
          text,
          span.charStart,
          span.charEnd,
          maxChunkLength,
        ),
      );
    }
  }

  return finalChunks;
}

const FAST_FUNCTION_WORDS = new Set([
  "a",
  "an",
  "the",
  "of",
  "to",
  "in",
  "on",
  "at",
  "by",
  "for",
  "with",
  "from",
  "into",
  "onto",
  "as",
  "is",
  "was",
  "were",
  "are",
  "be",
  "been",
  "it",
  "its",
  "that",
  "and",
  "or",
  "but",
  "if",
  "so",
  "he",
  "she",
  "we",
  "they",
  "you",
  "i",
  "his",
  "her",
  "their",
  "my",
  "our",
]);

function expandSpokenTokenForWeight(token: string): string {
  return token
    .replace(/\bD[Rr]\.?$/i, "doctor")
    .replace(/\bMr\.?$/i, "mister")
    .replace(/\bMrs\.?$/i, "missus")
    .replace(/\bMs\.?$/i, "miss")
    .replace(/[$£](\d+)(?:\.(\d+))?/g, "$1 dollars $2 cents")
    .replace(/(\d+)\.(\d+)/g, "$1 point $2")
    .replace(/\b(\d{4})s?\b/g, "nineteen twenty")
    .replace(/\d/g, "three ");
}

/**
 * Estimates relative spoken phoneme/syllable duration weight for a single word token,
 * stripping silent quote/punctuation characters and accounting for syllable nuclei,
 * silent final '-e', spoken number/abbreviation expansions, and unstressed function words.
 */
export function estimateWordSpokenWeight(rawWord: string): number {
  const cleanQuotes = rawWord.replace(
    /^["'“‘(\[{«]+|["'”’)\]}».,!?;:—…]+$/g,
    "",
  );
  if (!cleanQuotes) {
    return 0.4;
  }

  const expanded = expandSpokenTokenForWeight(cleanQuotes).toLowerCase();
  const alpha = expanded.replace(/[^a-z]/g, "");
  if (!alpha) {
    return Math.max(0.5, Array.from(cleanQuotes).length * 0.6);
  }

  const vowelGroups = (alpha.match(/[aeiouy]+/g) ?? []).length;
  const hasSilentE =
    /[^aeiouy]e$/.test(alpha) && alpha.length > 3 && !/(le|re)$/.test(alpha);
  const syllables = Math.max(1, vowelGroups - (hasSilentE ? 1 : 0));

  let weight = syllables * 1.15 + alpha.length * 0.38;
  if (FAST_FUNCTION_WORDS.has(alpha)) {
    weight *= 0.68;
  }
  return Math.max(0.55, weight);
}

interface RawWordToken {
  text: string;
  charStart: number;
  charEnd: number;
  wordIndex: number;
  weight: number;
  hasClausePunct: boolean;
}

function extractWordTokens(
  text: string,
  chunkCharStart: number,
  startingWordIndex: number,
): RawWordToken[] {
  const tokens: RawWordToken[] = [];
  let i = 0;
  let nextWordIndex = startingWordIndex;

  while (i < text.length) {
    if (/\s/.test(text[i])) {
      i++;
      continue;
    }
    let j = i + 1;
    while (j < text.length && !/\s/.test(text[j])) {
      j++;
    }
    const raw = text.slice(i, j);
    const strippedTrailingQuotes = raw.replace(/["'”’)\]}»]+$/, "");
    tokens.push({
      text: raw,
      charStart: chunkCharStart + i,
      charEnd: chunkCharStart + j,
      wordIndex: nextWordIndex++,
      weight: estimateWordSpokenWeight(raw),
      hasClausePunct: /[,;:—….!?]$/.test(strippedTrailingQuotes),
    });
    i = j;
  }

  return tokens;
}

/**
 * Aligns words to a synthesized TTS PCM waveform (`samples`) by:
 * 1. Detecting actual speech onset and offset (stripping Kokoro's ~300ms leading silence
 *    and ~500ms trailing silence so word timestamps do not progressively lag behind speech).
 * 2. Detecting internal acoustic pause valleys (>= 80ms silence) and anchoring clause
 *    punctuation breaks (commas, semicolons, colons, dashes) via a speaking-rate-constrained
 *    monotonic DAG match.
 * 3. Distributing active speech frames across words in each clause using phonological weights.
 */
export function buildWaveformWordAlignmentData(
  text: string,
  samples: Float32Array,
  sampleRate: number,
  chunkOffsetSeconds: number,
  options: {
    chunkCharStart?: number;
    chunkIndex?: number;
    startingWordIndex?: number;
  } = {},
): WordTimestamp[] {
  const {
    chunkCharStart = 0,
    chunkIndex = 0,
    startingWordIndex = 0,
  } = options;

  if (samples.length === 0 || sampleRate <= 0) {
    return buildWordAlignmentData(text, 0, chunkOffsetSeconds, options);
  }

  const tokens = extractWordTokens(text, chunkCharStart, startingWordIndex);
  if (tokens.length === 0) {
    return [];
  }

  // 10ms RMS energy envelope
  const frameSamples = Math.max(1, Math.round(sampleRate * 0.01));
  const numFrames = Math.ceil(samples.length / frameSamples);
  const rms = new Float32Array(numFrames);
  let maxRms = 0;

  for (let f = 0; f < numFrames; f++) {
    const start = f * frameSamples;
    const end = Math.min(samples.length, start + frameSamples);
    let sumSq = 0;
    for (let k = start; k < end; k++) {
      const s = samples[k];
      sumSq += s * s;
    }
    const frameRms = Math.sqrt(sumSq / Math.max(1, end - start));
    rms[f] = frameRms;
    if (frameRms > maxRms) {
      maxRms = frameRms;
    }
  }

  // Fallback to uniform character alignment if audio is completely silent
  if (maxRms < 1e-5) {
    return buildWordAlignmentData(
      text,
      samples.length / sampleRate,
      chunkOffsetSeconds,
      options,
    );
  }

  const onsetThreshold = Math.max(0.002, maxRms * 0.02);
  let firstSpeech = 0;
  while (firstSpeech < numFrames && rms[firstSpeech] < onsetThreshold) {
    firstSpeech++;
  }
  let lastSpeech = numFrames - 1;
  while (lastSpeech > firstSpeech && rms[lastSpeech] < onsetThreshold) {
    lastSpeech--;
  }

  // Keep 10ms pre-roll and post-roll for soft unvoiced fricatives/stops
  firstSpeech = Math.max(0, firstSpeech - 1);
  lastSpeech = Math.min(numFrames - 1, lastSpeech + 1);

  const offsetMs = chunkOffsetSeconds * 1000;
  const maxChunkEndMs = Math.round(
    (chunkOffsetSeconds + samples.length / sampleRate) * 1000,
  );

  if (tokens.length === 1) {
    const startMs = Math.round(
      offsetMs + ((firstSpeech * frameSamples) / sampleRate) * 1000,
    );
    const endMs = Math.min(
      maxChunkEndMs,
      Math.max(
        startMs + 20,
        Math.round(
          offsetMs + (((lastSpeech + 1) * frameSamples) / sampleRate) * 1000,
        ),
      ),
    );
    return [
      {
        text: tokens[0].text,
        startMs,
        endMs,
        charStart: tokens[0].charStart,
        charEnd: tokens[0].charEnd,
        chunkIndex,
        wordIndex: tokens[0].wordIndex,
      },
    ];
  }

  // Detect internal silent pause valleys (>= 80ms = 8 frames)
  const pauseThreshold = Math.max(0.0035, maxRms * 0.03);
  const valleys: Array<{
    startFrame: number;
    endFrame: number;
    durFrames: number;
  }> = [];
  const isPause = new Uint8Array(numFrames);
  let runStart = -1;

  for (let f = firstSpeech; f <= lastSpeech + 1; f++) {
    if (f <= lastSpeech && rms[f] < pauseThreshold) {
      if (runStart === -1) runStart = f;
    } else if (runStart !== -1) {
      const durFrames = f - runStart;
      if (
        durFrames >= 8 &&
        runStart > firstSpeech + 3 &&
        f <= lastSpeech - 2
      ) {
        valleys.push({ startFrame: runStart, endFrame: f, durFrames });
        for (let k = runStart; k < f; k++) {
          isPause[k] = 1;
        }
      }
      runStart = -1;
    }
  }

  const cumSpeech = new Float64Array(numFrames + 1);
  for (let f = firstSpeech; f <= lastSpeech; f++) {
    cumSpeech[f + 1] = cumSpeech[f] + (isPause[f] ? 0 : 1);
  }
  for (let f = lastSpeech + 1; f < numFrames; f++) {
    cumSpeech[f + 1] = cumSpeech[f];
  }
  const totalSpeechFrames = Math.max(
    1,
    cumSpeech[lastSpeech + 1] - cumSpeech[firstSpeech],
  );

  const cumWordWeight = new Float64Array(tokens.length + 1);
  for (let w = 0; w < tokens.length; w++) {
    cumWordWeight[w + 1] = cumWordWeight[w] + tokens[w].weight;
  }
  const totalWordWeight = Math.max(1e-6, cumWordWeight[tokens.length]);
  const meanRate = totalSpeechFrames / totalWordWeight;

  const clauseBreaks: Array<{ wordEnd: number; ratio: number }> = [];
  for (let w = 0; w < tokens.length - 1; w++) {
    if (tokens[w].hasClausePunct) {
      clauseBreaks.push({
        wordEnd: w + 1,
        ratio: cumWordWeight[w + 1] / totalWordWeight,
      });
    }
  }

  const valleyNodes = valleys.map((v) => {
    const speechPos = cumSpeech[v.startFrame] - cumSpeech[firstSpeech];
    return {
      ...v,
      speechPos,
      ratio: speechPos / totalSpeechFrames,
    };
  });

  interface DagNode {
    b: number;
    v: number;
    wordEnd: number;
    speechPos: number;
    valleyStartFrame: number;
    valleyEndFrame: number;
    bonus: number;
  }

  const dagNodes: DagNode[] = [
    {
      b: -1,
      v: -1,
      wordEnd: 0,
      speechPos: 0,
      valleyStartFrame: firstSpeech,
      valleyEndFrame: firstSpeech,
      bonus: 0,
    },
  ];

  for (let b = 0; b < clauseBreaks.length; b++) {
    for (let v = 0; v < valleyNodes.length; v++) {
      const dist = Math.abs(clauseBreaks[b].ratio - valleyNodes[v].ratio);
      if (dist <= 0.15) {
        dagNodes.push({
          b,
          v,
          wordEnd: clauseBreaks[b].wordEnd,
          speechPos: valleyNodes[v].speechPos,
          valleyStartFrame: valleyNodes[v].startFrame,
          valleyEndFrame: valleyNodes[v].endFrame,
          bonus:
            1.2 +
            Math.min(0.8, valleyNodes[v].durFrames * 0.03) -
            dist * 5.0,
        });
      }
    }
  }

  dagNodes.push({
    b: clauseBreaks.length,
    v: valleyNodes.length,
    wordEnd: tokens.length,
    speechPos: totalSpeechFrames,
    valleyStartFrame: lastSpeech + 1,
    valleyEndFrame: lastSpeech + 1,
    bonus: 0,
  });

  const nodeCount = dagNodes.length;
  const bestScore = new Float64Array(nodeCount).fill(-Infinity);
  const prevNode = new Int32Array(nodeCount).fill(-1);
  bestScore[0] = 0;

  for (let i = 0; i < nodeCount; i++) {
    if (bestScore[i] === -Infinity) continue;
    for (let j = i + 1; j < nodeCount; j++) {
      if (dagNodes[j].b <= dagNodes[i].b || dagNodes[j].v <= dagNodes[i].v) {
        continue;
      }
      const segWords = dagNodes[j].wordEnd - dagNodes[i].wordEnd;
      const dWeight =
        cumWordWeight[dagNodes[j].wordEnd] - cumWordWeight[dagNodes[i].wordEnd];
      const dSpeech = dagNodes[j].speechPos - dagNodes[i].speechPos;
      if (segWords <= 0 || dWeight <= 0 || dSpeech <= 0) continue;

      const relRate = dSpeech / dWeight / meanRate;
      const minRelRate = segWords <= 2 ? 0.55 : 0.68;
      const maxRelRate = segWords <= 2 ? 1.75 : 1.45;
      if (relRate < minRelRate || relRate > maxRelRate) continue;

      const ratePenalty = Math.abs(Math.log(relRate)) * 1.1;
      const candidateScore =
        bestScore[i] + dagNodes[j].bonus - ratePenalty;
      if (candidateScore > bestScore[j]) {
        bestScore[j] = candidateScore;
        prevNode[j] = i;
      }
    }
  }

  const anchors: DagNode[] = [];
  if (prevNode[nodeCount - 1] !== -1) {
    let cur = prevNode[nodeCount - 1];
    while (cur > 0) {
      anchors.push(dagNodes[cur]);
      cur = prevNode[cur];
    }
    anchors.reverse();
  }

  const segments: Array<{
    wStart: number;
    wEnd: number;
    fStart: number;
    fEnd: number;
  }> = [];
  let wCursor = 0;
  let fCursor = firstSpeech;
  for (const anchor of anchors) {
    segments.push({
      wStart: wCursor,
      wEnd: anchor.wordEnd,
      fStart: fCursor,
      fEnd: anchor.valleyStartFrame,
    });
    wCursor = anchor.wordEnd;
    fCursor = anchor.valleyEndFrame;
  }
  segments.push({
    wStart: wCursor,
    wEnd: tokens.length,
    fStart: fCursor,
    fEnd: lastSpeech + 1,
  });

  const alignedWords: WordTimestamp[] = [];
  let prevEndMs = Math.round(offsetMs);

  for (const seg of segments) {
    const segTokens = tokens.slice(seg.wStart, seg.wEnd);
    if (segTokens.length === 0) continue;

    const segWeight = segTokens.reduce((sum, t) => sum + t.weight, 0);
    const lenF = Math.max(1, seg.fEnd - seg.fStart);
    const localCum = new Float64Array(lenF + 1);
    for (let k = 0; k < lenF; k++) {
      localCum[k + 1] = localCum[k] + (isPause[seg.fStart + k] ? 0 : 1);
    }
    if (localCum[lenF] <= 0) {
      for (let k = 0; k < lenF; k++) {
        localCum[k + 1] = k + 1;
      }
    }
    const localTotal = Math.max(1e-6, localCum[lenF]);

    const mapWeightToMs = (wVal: number, isStart: boolean): number => {
      const target = (wVal / Math.max(1e-6, segWeight)) * localTotal;
      let lo = 0;
      let hi = lenF;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (localCum[mid] < target) lo = mid + 1;
        else hi = mid;
      }
      let k = Math.max(0, Math.min(lenF - 1, lo - 1));
      if (isStart) {
        while (k < lenF - 1 && isPause[seg.fStart + k]) k++;
      } else {
        while (k > 0 && isPause[seg.fStart + k]) k--;
      }
      const base = localCum[k];
      const step = localCum[k + 1] - localCum[k];
      const frac =
        step > 0 && k === lo - 1
          ? Math.max(0, Math.min(1, (target - base) / step))
          : isStart
            ? 0
            : 1;
      const samplePos = (seg.fStart + k + frac) * frameSamples;
      return Math.round(offsetMs + (samplePos / sampleRate) * 1000);
    };

    let weightAcc = 0;
    for (let m = 0; m < segTokens.length; m++) {
      const tok = segTokens[m];
      const rawStart = mapWeightToMs(weightAcc, true);
      weightAcc += tok.weight;
      const rawEnd = mapWeightToMs(weightAcc, false);

      const startMs = Math.min(maxChunkEndMs, Math.max(prevEndMs, rawStart));
      const endMs = Math.min(maxChunkEndMs, Math.max(startMs, rawEnd));
      prevEndMs = endMs;

      alignedWords.push({
        text: tok.text,
        startMs,
        endMs,
        charStart: tok.charStart,
        charEnd: tok.charEnd,
        chunkIndex,
        wordIndex: tok.wordIndex,
      });
    }
  }

  return alignedWords;
}

/**
 * Builds word-level timestamps for a synthesized TTS chunk using character-proportional
 * chunk duration alignment as described in https://ryanwelch.co.uk/blog/kokoro-word-timestamps/.
 */
export function buildWordAlignmentData(
  text: string,
  chunkDurationSeconds: number,
  chunkOffsetSeconds: number,
  options: {
    chunkCharStart?: number;
    chunkIndex?: number;
    startingWordIndex?: number;
  } = {},
): WordTimestamp[] {
  const {
    chunkCharStart = 0,
    chunkIndex = 0,
    startingWordIndex = 0,
  } = options;

  const chars = Array.from(text);
  const charDuration =
    chars.length > 0 ? chunkDurationSeconds / chars.length : 0;
  const words: WordTimestamp[] = [];

  let currentText = "";
  let currentStartMs: number | null = null;
  let currentEndMs: number | null = null;
  let currentCharStart: number | null = null;
  let utf16Offset = chunkCharStart;
  let nextWordIndex = startingWordIndex;

  chars.forEach((char, index) => {
    const startSeconds = chunkOffsetSeconds + index * charDuration;
    const endSeconds = startSeconds + charDuration;
    const startMs = Math.round(startSeconds * 1000);
    const endMs = Math.round(endSeconds * 1000);

    if (/\s/.test(char)) {
      if (currentText) {
        words.push({
          text: currentText,
          startMs: currentStartMs!,
          endMs: currentEndMs!,
          charStart: currentCharStart!,
          charEnd: utf16Offset,
          chunkIndex,
          wordIndex: nextWordIndex++,
        });
        currentText = "";
        currentStartMs = null;
        currentEndMs = null;
        currentCharStart = null;
      }
      utf16Offset += char.length;
      return;
    }

    if (currentStartMs === null) {
      currentStartMs = startMs;
      currentCharStart = utf16Offset;
    }

    currentText += char;
    currentEndMs = endMs;
    utf16Offset += char.length;
  });

  if (currentText) {
    words.push({
      text: currentText,
      startMs: currentStartMs!,
      endMs: currentEndMs!,
      charStart: currentCharStart!,
      charEnd: utf16Offset,
      chunkIndex,
      wordIndex: nextWordIndex,
    });
  }

  return words;
}

const IPA_MODIFIER_SYMBOLS = new Set([
  "ˈ",
  "ˌ",
  "ː",
  "ʰ",
  "ʲ",
  "̃",
  "ᵝ",
  "ᵊ",
  "↓",
  "→",
  "↗",
  "↘",
]);

const TOKEN_PUNCTUATION_SYMBOLS = new Set([
  ";",
  ":",
  ",",
  ".",
  "!",
  "?",
  "¡",
  "¿",
  "—",
  "…",
  '"',
  "«",
  "»",
  "“",
  "”",
  "(",
  ")",
  "[",
  "]",
  "{",
  "}",
  "।",
  "॥",
  "$",
]);

const CLAUSE_PUNCTUATION_SYMBOLS = new Set([
  ";",
  ":",
  ",",
  ".",
  "!",
  "?",
  "¡",
  "¿",
  "—",
  "…",
  "।",
  "॥",
]);

function roundHalfToEven(value: number): number {
  const floor = Math.floor(value);
  const diff = value - floor;
  if (diff < 0.5) return floor;
  if (diff > 0.5) return floor + 1;
  return floor % 2 === 0 ? floor : floor + 1;
}

type PhoneticFeatureClass = "V" | "N" | "L" | "F" | "S";

function classifyIpaSymbol(sym: string): PhoneticFeatureClass {
  if ("ɑɐɒæɔəɚɛɜɪɨɯøœɶʊʌaeiouyᵻɤAIOQWY".includes(sym)) return "V";
  if ("mnŋɳɲɴ".includes(sym)) return "N";
  if ("lɹɾɻʁɽʎwɥjɰrT".includes(sym)) return "L";
  if ("fvθðszʃʒɕʑçʝxɣχħʕhɦβɸʂS".includes(sym)) return "F";
  return "S";
}

function splitNumForAlignment(match: string): string {
  if (match.includes(".")) {
    return match;
  } else if (match.includes(":")) {
    const [h, m] = match.split(":").map(Number);
    if (m === 0) {
      return `${h} o'clock`;
    } else if (m < 10) {
      return `${h} oh ${m}`;
    }
    return `${h} ${m}`;
  }
  const year = parseInt(match.slice(0, 4), 10);
  if (year < 1100 || year % 1000 < 10) {
    return match;
  }
  const left = match.slice(0, 2);
  const right = parseInt(match.slice(2, 4), 10);
  const suffix = match.endsWith("s") ? "s" : "";
  if (year % 1000 >= 100 && year % 1000 <= 999) {
    if (right === 0) {
      return `${left} hundred${suffix}`;
    } else if (right < 10) {
      return `${left} oh ${right}${suffix}`;
    }
  }
  return `${left} ${right}${suffix}`;
}

function flipMoneyForAlignment(match: string): string {
  const bill = match[0] === "$" ? "dollar" : "pound";
  if (Number.isNaN(Number(match.slice(1)))) {
    return `${match.slice(1)} ${bill}s`;
  } else if (!match.includes(".")) {
    const suffix = match.slice(1) === "1" ? "" : "s";
    return `${match.slice(1)} ${bill}${suffix}`;
  }
  const [b, c] = match.slice(1).split(".");
  const d = parseInt(c.padEnd(2, "0"), 10);
  const coins =
    match[0] === "$"
      ? d === 1
        ? "cent"
        : "cents"
      : d === 1
        ? "penny"
        : "pence";
  return `${b} ${bill}${b === "1" ? "" : "s"} and ${d} ${coins}`;
}

function pointNumForAlignment(match: string): string {
  const [a, b] = match.split(".");
  return `${a} point ${b.split("").join(" ")}`;
}

function normalizeForAlignment(text: string): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/«/g, "“")
    .replace(/»/g, "”")
    .replace(/[“”]/g, '"')
    .replace(/\(/g, "«")
    .replace(/\)/g, "»")
    .replace(/、/g, ", ")
    .replace(/。/g, ". ")
    .replace(/！/g, "! ")
    .replace(/，/g, ", ")
    .replace(/：/g, ": ")
    .replace(/；/g, "; ")
    .replace(/？/g, "? ")
    .replace(/[^\S \n]/g, " ")
    .replace(/  +/g, " ")
    .replace(/\bD[Rr]\.(?= [A-Z])/g, "Doctor")
    .replace(/\b(?:Mr\.|MR\.(?= [A-Z]))/g, "Mister")
    .replace(/\b(?:Ms\.|MS\.(?= [A-Z]))/g, "Miss")
    .replace(/\b(?:Mrs\.|MRS\.(?= [A-Z]))/g, "Mrs")
    .replace(/\betc\.(?! [A-Z])/gi, "etc")
    .replace(/\b(y)eah?\b/gi, "$1e'a")
    .replace(
      /\d*\.\d+|\b\d{4}s?\b|(?<!:)\b(?:[1-9]|1[0-2]):[0-5]\d\b(?!:)/g,
      splitNumForAlignment,
    )
    .replace(/(?<=\d),(?=\d)/g, "")
    .replace(
      /[$£]\d+(?:\.\d+)?(?: hundred| thousand| (?:[bm]|tr)illion)*\b|[$£]\d+\.\d\d?\b/gi,
      flipMoneyForAlignment,
    )
    .replace(/\d*\.\d+/g, pointNumForAlignment)
    .replace(/(?<=\d)-(?=\d)/g, " to ")
    .replace(/(?<=\d)S/g, " S")
    .replace(/(?<=[BCDFGHJ-NP-TV-Z])'?s\b/g, "'S")
    .replace(/(?<=X')S\b/g, "s")
    .replace(/(?:[A-Za-z]\.){2,} [a-z]/g, (m) => m.replace(/\./g, "-"))
    .replace(/(?<=[A-Z])\.(?=[A-Z])/gi, "-")
    .trim();
}

const NUMBER_ONES = [
  "",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
];

const NUMBER_TENS = [
  "",
  "",
  "twenty",
  "thirty",
  "forty",
  "fifty",
  "sixty",
  "seventy",
  "eighty",
  "ninety",
];

function numberToSubwords(numStr: string): string[] {
  if (numStr.length > 12) {
    return numStr
      .split("")
      .map((digit) => (digit === "0" ? "zero" : NUMBER_ONES[Number(digit)] || digit));
  }
  const n = parseInt(numStr, 10);
  if (Number.isNaN(n)) return [numStr];
  if (n === 0) return ["zero"];

  const out: string[] = [];
  let rem = n;
  if (rem >= 1_000_000_000) {
    out.push(
      ...numberToSubwords(String(Math.floor(rem / 1_000_000_000))),
      "billion",
    );
    rem %= 1_000_000_000;
  }
  if (rem >= 1_000_000) {
    out.push(...numberToSubwords(String(Math.floor(rem / 1_000_000))), "million");
    rem %= 1_000_000;
  }
  if (rem >= 1000) {
    out.push(...numberToSubwords(String(Math.floor(rem / 1000))), "thousand");
    rem %= 1000;
  }
  if (rem >= 100) {
    out.push(NUMBER_ONES[Math.floor(rem / 100)], "hundred");
    rem %= 100;
  }
  if (rem >= 20) {
    out.push(NUMBER_TENS[Math.floor(rem / 10)]);
    if (rem % 10 > 0) out.push(NUMBER_ONES[rem % 10]);
  } else if (rem > 0) {
    out.push(NUMBER_ONES[rem]);
  }
  return out;
}

function wordToPhoneticClasses(subword: string): PhoneticFeatureClass[] {
  let clean = subword
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  if (!clean) return ["V"];

  if (/^\d+(?:st|nd|rd|th)?$/.test(clean)) {
    if (clean === "1st") clean = "first";
    else if (clean === "2nd") clean = "second";
    else if (clean === "3rd") clean = "third";
    else if (clean === "5th") clean = "fifth";
    else {
      const hasOrdinal = /(?:st|nd|rd|th)$/.test(clean);
      const digits = clean.replace(/(?:st|nd|rd|th)$/, "");
      clean = numberToSubwords(digits).join("") + (hasOrdinal ? "th" : "");
    }
  }

  if (clean === "one") clean = "wan";
  else if (clean === "once") clean = "wans";
  else if (clean.startsWith("who")) clean = `h${clean.slice(2)}`;
  else if (/^(?:kn|gn|pn|ps|wr)/.test(clean)) clean = clean.slice(1);

  const classes: PhoneticFeatureClass[] = [];
  const pushClass = (cls: PhoneticFeatureClass) => {
    if (classes.at(-1) !== cls) classes.push(cls);
  };

  let i = 0;
  while (i < clean.length) {
    const two = clean.slice(i, i + 2);
    if (two === "th" || two === "sh" || two === "ph" || two === "gh") {
      pushClass("F");
      i += 2;
      continue;
    }
    if (two === "wh") {
      pushClass("L");
      i += 2;
      continue;
    }
    if (two === "ch" || two === "ck" || two === "dg") {
      pushClass("S");
      i += 2;
      continue;
    }
    if (two === "ng") {
      pushClass("N");
      i += 2;
      continue;
    }
    if (two === "qu") {
      pushClass("S");
      pushClass("L");
      i += 2;
      continue;
    }

    const c = clean[i];
    if (c === "x") {
      pushClass("S");
      pushClass("F");
      i++;
      continue;
    }
    if ("aeiouy".includes(c)) {
      if (
        c === "e" &&
        i === clean.length - 1 &&
        classes.includes("V") &&
        clean.length > 2
      ) {
        i++;
        continue;
      }
      pushClass("V");
    } else if ("mn".includes(c)) {
      pushClass("N");
    } else if ("lrwj".includes(c)) {
      pushClass("L");
    } else if ("fvszh".includes(c)) {
      pushClass("F");
    } else {
      pushClass("S");
    }
    i++;
  }

  return classes.length > 0 ? classes : ["V"];
}

function phoneticFeatureDistance(
  expected: readonly PhoneticFeatureClass[],
  observed: readonly PhoneticFeatureClass[],
): number {
  const m = expected.length;
  const n = observed.length;
  let prev = new Float64Array(n + 1);
  let curr = new Float64Array(n + 1);

  for (let j = 0; j <= n; j++) {
    prev[j] = j * 0.9;
  }

  for (let i = 1; i <= m; i++) {
    curr[0] = i * 0.9;
    for (let j = 1; j <= n; j++) {
      const subCost = expected[i - 1] === observed[j - 1] ? 0 : 1.1;
      const del = prev[j] + 0.9;
      const ins = curr[j - 1] + 0.9;
      const sub = prev[j - 1] + subCost;
      curr[j] = Math.min(del, ins, sub);
    }
    const tmp = prev;
    prev = curr;
    curr = tmp;
  }

  return prev[n];
}

function expandSourceWordsForDurations(wordSegs: readonly TextSegment[]): string[][] {
  return wordSegs.map((seg, idx) => {
    const nextSeg = wordSegs[idx + 1];
    const probe = nextSeg ? `${seg.text} ${nextSeg.text}` : seg.text;
    const normProbe = normalizeForAlignment(probe);
    const normNext = nextSeg ? normalizeForAlignment(nextSeg.text) : "";
    let normWord = seg.text;

    if (nextSeg && normNext && normProbe.endsWith(` ${normNext}`)) {
      normWord = normProbe.slice(0, normProbe.length - normNext.length - 1);
    } else {
      normWord = normalizeForAlignment(seg.text);
    }

    const rawParts = normWord.split(/\s+/).filter(Boolean);
    const subwords: string[] = [];
    for (const part of rawParts) {
      const stripped = part.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
      if (/^\d+$/.test(stripped)) {
        subwords.push(...numberToSubwords(stripped));
      } else if (
        stripped.includes("-") &&
        stripped.split("-").every((piece) => piece.length <= 1)
      ) {
        subwords.push(stripped.replace(/-/g, ""));
      } else if (stripped.length > 0) {
        subwords.push(stripped);
      } else {
        subwords.push(part);
      }
    }

    return subwords.length > 0 ? subwords : [seg.text];
  });
}

/**
 * Computes exact word-level timestamps directly from native per-token `durations` output tensors
 * (`Kokoro-82M-v1.0-ONNX-timestamped` `durations` or `Paradee-8M-v1.3` `/Clip_output_0`) and
 * decoded IPA/punctuation `tokens`.
 *
 * Each integer frame in `roundHalfToEven(durations[i])` spans 600 waveform samples (25ms at 24 kHz)
 * across all speeds, including BOS/EOS leading/trailing silence (`tokens[0] === "$"`, `tokens[N-1] === "$"`),
 * punctuation pauses, and individual phoneme durations. When `options.wordTokenSpans` is supplied
 * (from per-word G2P such as Paradee's Hindi/French/Spanish G2P), each word reads its exact
 * `[firstTokenIndex, lastTokenIndex]` token range directly; otherwise source words are aligned
 * monotonically to spoken phoneme tokens via phonetic-feature dynamic programming.
 */
export function buildDurationWordAlignmentData(
  text: string,
  tokens: readonly string[],
  durations: ArrayLike<number>,
  totalSamples: number,
  sampleRate: number,
  offsetSeconds = 0,
  options: {
    chunkCharStart?: number;
    chunkIndex?: number;
    startingWordIndex?: number;
    samples?: Float32Array;
    wordTokenSpans?: ReadonlyArray<WordTokenSpan | null>;
  } = {},
): WordTimestamp[] {
  const {
    chunkCharStart = 0,
    chunkIndex = 0,
    startingWordIndex = 0,
    samples,
    wordTokenSpans,
  } = options;

  if (!text) return [];

  const fallback = (): WordTimestamp[] => {
    const chunkDurationSeconds =
      sampleRate > 0 ? totalSamples / sampleRate : 0;
    return samples && samples.length > 0
      ? buildWaveformWordAlignmentData(
          text,
          samples,
          sampleRate,
          offsetSeconds,
          { chunkCharStart, chunkIndex, startingWordIndex },
        )
      : buildWordAlignmentData(text, chunkDurationSeconds, offsetSeconds, {
          chunkCharStart,
          chunkIndex,
          startingWordIndex,
        });
  };

  if (
    sampleRate <= 0 ||
    totalSamples <= 0 ||
    tokens.length < 2 ||
    durations.length !== tokens.length
  ) {
    return fallback();
  }

  const { segments } = segmentTextIntoWords(text);
  const wordSegs = segments.filter((seg) => seg.type === "word");
  if (wordSegs.length === 0) return [];

  const tokenCount = tokens.length;
  const roundedUnits = new Float64Array(tokenCount);
  let sumRounded = 0;
  for (let i = 0; i < tokenCount; i++) {
    const v = Math.max(0, roundHalfToEven(Number(durations[i]) || 0));
    roundedUnits[i] = v;
    sumRounded += v;
  }

  let units = roundedUnits;
  let totalUnits = sumRounded;
  if (totalUnits <= 0) {
    const rawUnits = new Float64Array(tokenCount);
    let sumRaw = 0;
    for (let i = 0; i < tokenCount; i++) {
      const v = Math.max(0, Number(durations[i]) || 0);
      rawUnits[i] = v;
      sumRaw += v;
    }
    if (sumRaw <= 0) return fallback();
    units = rawUnits;
    totalUnits = sumRaw;
  }

  const chunkDurationSec = totalSamples / sampleRate;
  const secPerUnit = chunkDurationSec / totalUnits;
  const tokStartSec = new Float64Array(tokenCount);
  const tokEndSec = new Float64Array(tokenCount);
  let accSec = 0;
  for (let i = 0; i < tokenCount; i++) {
    tokStartSec[i] = accSec;
    accSec += units[i] * secPerUnit;
    tokEndSec[i] = accSec;
  }

  const startTokIdx = tokens[0] === "$" ? 1 : 0;
  const endTokIdx =
    tokens[tokenCount - 1] === "$" ? tokenCount - 1 : tokenCount;

  interface PhonemeTokenEntry {
    tokIdx: number;
    cls: PhoneticFeatureClass | null;
    hadSep: boolean;
    hadClausePunct: boolean;
  }

  const phonToks: PhonemeTokenEntry[] = [];
  for (let i = startTokIdx; i < endTokIdx; i++) {
    const sym = tokens[i];
    if (!sym || sym === " " || TOKEN_PUNCTUATION_SYMBOLS.has(sym)) {
      continue;
    }
    let hadSep = phonToks.length === 0;
    let hadClausePunct = false;
    if (phonToks.length > 0) {
      const prevIdx = phonToks[phonToks.length - 1].tokIdx;
      for (let k = prevIdx + 1; k < i; k++) {
        const sepSym = tokens[k];
        if (sepSym === " " || TOKEN_PUNCTUATION_SYMBOLS.has(sepSym)) {
          hadSep = true;
        }
        if (CLAUSE_PUNCTUATION_SYMBOLS.has(sepSym)) {
          hadClausePunct = true;
        }
      }
    }
    phonToks.push({
      tokIdx: i,
      cls: IPA_MODIFIER_SYMBOLS.has(sym) ? null : classifyIpaSymbol(sym),
      hadSep,
      hadClausePunct,
    });
  }

  const wordFirstTokIdx = new Int32Array(wordSegs.length).fill(-1);
  const wordLastTokIdx = new Int32Array(wordSegs.length).fill(-1);

  if (wordTokenSpans && wordTokenSpans.length === wordSegs.length) {
    let hasMappedWord = false;
    for (let w = 0; w < wordSegs.length; w++) {
      const span = wordTokenSpans[w];
      if (
        span &&
        span.firstTokenIndex >= 0 &&
        span.lastTokenIndex >= span.firstTokenIndex &&
        span.lastTokenIndex < tokenCount
      ) {
        wordFirstTokIdx[w] = span.firstTokenIndex;
        wordLastTokIdx[w] = span.lastTokenIndex;
        hasMappedWord = true;
      }
    }
    if (!hasMappedWord && phonToks.length === 0) {
      return fallback();
    }
  } else {
    if (phonToks.length === 0) {
      return fallback();
    }

    interface AlignmentSubUnit {
      wordIdx: number;
      classes: PhoneticFeatureClass[];
      hasPunctAfter: boolean;
      isSilentPunct: boolean;
    }

    const expandedPerWord = expandSourceWordsForDurations(wordSegs);
    const subUnits: AlignmentSubUnit[] = [];
    expandedPerWord.forEach((subs, wordIdx) => {
      const rawWord = wordSegs[wordIdx].text;
      const trailingSlice = rawWord.slice(-2);
      subs.forEach((sw, subIdx) => {
        const isSilentPunct =
          !/[\p{L}\p{N}\p{Extended_Pictographic}]/u.test(sw);
        const hasPunctAfter =
          subIdx === subs.length - 1 && /[,.;:!?¡¿—…।॥]/.test(trailingSlice);
        subUnits.push({
          wordIdx,
          classes: wordToPhoneticClasses(sw),
          hasPunctAfter,
          isSilentPunct,
        });
      });
    });

    const U = subUnits.length;
    const P = phonToks.length;
    const INF = 1e12;
    const dp = Array.from({ length: U + 1 }, () =>
      new Float64Array(P + 1).fill(INF),
    );
    const parent = Array.from({ length: U + 1 }, () =>
      new Int32Array(P + 1).fill(-1),
    );
    dp[0][0] = 0;

    const strideLimit = Math.max(40, Math.ceil((P / Math.max(1, U)) * 4));

    for (let u = 0; u < U; u++) {
      const unit = subUnits[u];
      const skipCost = unit.isSilentPunct ? 0.5 : 30.0;

      for (let p = 0; p <= P; p++) {
        const baseCost = dp[u][p];
        if (baseCost >= INF / 2) continue;

        if (baseCost + skipCost < dp[u + 1][p]) {
          dp[u + 1][p] = baseCost + skipCost;
          parent[u + 1][p] = p;
        }

        if (p >= P) continue;

        const boundaryCost = u > 0 ? (phonToks[p].hadSep ? 0 : 3.2) : 0;
        const maxQ = u === U - 1 ? P : Math.min(P, p + strideLimit);
        const observedClasses: PhoneticFeatureClass[] = [];
        let internalSeparators = 0;

        for (let q = p + 1; q <= maxQ; q++) {
          const pt = phonToks[q - 1];
          if (q > p + 1) {
            if (pt.hadSep) internalSeparators += 1;
            if (pt.hadClausePunct) internalSeparators += 3;
          }
          if (pt.cls && observedClasses.at(-1) !== pt.cls) {
            observedClasses.push(pt.cls);
          }

          let punctMismatchCost = 0;
          if (q < P) {
            const nextHasPunct = phonToks[q].hadClausePunct;
            if (unit.hasPunctAfter !== nextHasPunct) {
              punctMismatchCost = 2.5;
            }
          }

          const internalCost = internalSeparators * 6.0;
          const dist = phoneticFeatureDistance(unit.classes, observedClasses);
          const candidateCost =
            baseCost + boundaryCost + internalCost + punctMismatchCost + dist;

          if (candidateCost < dp[u + 1][q]) {
            dp[u + 1][q] = candidateCost;
            parent[u + 1][q] = p;
          }
        }
      }
    }

    if (dp[U][P] >= INF / 2) {
      return fallback();
    }

    const subSpans: Array<[number, number]> = new Array(U);
    let cursor = P;
    for (let u = U; u >= 1; u--) {
      const prev = parent[u][cursor];
      const safePrev = prev >= 0 ? prev : cursor;
      subSpans[u - 1] = [safePrev, cursor];
      cursor = safePrev;
    }

    for (let u = 0; u < U; u++) {
      const wIdx = subUnits[u].wordIdx;
      const [a, b] = subSpans[u];
      if (b > a) {
        const firstIdx = phonToks[a].tokIdx;
        const lastIdx = phonToks[b - 1].tokIdx;
        if (wordFirstTokIdx[wIdx] === -1 || firstIdx < wordFirstTokIdx[wIdx]) {
          wordFirstTokIdx[wIdx] = firstIdx;
        }
        if (lastIdx > wordLastTokIdx[wIdx]) {
          wordLastTokIdx[wIdx] = lastIdx;
        }
      }
    }
  }

  const wordStartSec = new Float64Array(wordSegs.length);
  const wordEndSec = new Float64Array(wordSegs.length);

  for (let w = 0; w < wordSegs.length; w++) {
    if (wordFirstTokIdx[w] !== -1 && wordLastTokIdx[w] !== -1) {
      wordStartSec[w] = tokStartSec[wordFirstTokIdx[w]];
      wordEndSec[w] = tokEndSec[wordLastTokIdx[w]];
    }
  }

  // Resolve any unvoiced / standalone-punctuation words (e.g. "—") using interstitial tokens
  for (let w = 0; w < wordSegs.length; w++) {
    if (wordFirstTokIdx[w] !== -1) continue;

    let prevWord = w - 1;
    while (prevWord >= 0 && wordLastTokIdx[prevWord] === -1) prevWord--;
    let nextWord = w + 1;
    while (nextWord < wordSegs.length && wordFirstTokIdx[nextWord] === -1) {
      nextWord++;
    }

    const searchStart =
      prevWord >= 0 ? wordLastTokIdx[prevWord] + 1 : startTokIdx;
    const searchEnd =
      nextWord < wordSegs.length ? wordFirstTokIdx[nextWord] : endTokIdx;

    let matchedPunctIdx = -1;
    for (let k = searchStart; k < searchEnd; k++) {
      if (
        TOKEN_PUNCTUATION_SYMBOLS.has(tokens[k]) &&
        tokens[k] !== "$"
      ) {
        matchedPunctIdx = k;
        break;
      }
    }

    if (matchedPunctIdx !== -1) {
      wordStartSec[w] = tokStartSec[matchedPunctIdx];
      wordEndSec[w] = tokEndSec[matchedPunctIdx];
    } else {
      const fallbackLeftIdx =
        phonToks.length > 0
          ? phonToks[0].tokIdx
          : Math.min(startTokIdx, tokenCount - 1);
      const fallbackRightIdx =
        phonToks.length > 0
          ? phonToks[phonToks.length - 1].tokIdx
          : Math.max(0, Math.min(endTokIdx - 1, tokenCount - 1));
      const leftSec =
        prevWord >= 0 ? wordEndSec[prevWord] : tokStartSec[fallbackLeftIdx];
      const rightSec =
        nextWord < wordSegs.length
          ? wordStartSec[nextWord]
          : tokEndSec[fallbackRightIdx];
      const midSec = (leftSec + rightSec) * 0.5;
      wordStartSec[w] = midSec;
      wordEndSec[w] = midSec;
    }
  }

  const result: WordTimestamp[] = [];
  let prevEndMs = Math.round(offsetSeconds * 1000);

  for (let w = 0; w < wordSegs.length; w++) {
    const seg = wordSegs[w];
    const startMs = Math.max(
      prevEndMs,
      Math.round((offsetSeconds + wordStartSec[w]) * 1000),
    );
    const endMs = Math.max(
      startMs,
      Math.round((offsetSeconds + wordEndSec[w]) * 1000),
    );
    prevEndMs = endMs;

    result.push({
      text: seg.text,
      startMs,
      endMs,
      charStart: chunkCharStart + seg.charStart,
      charEnd: chunkCharStart + seg.charEnd,
      chunkIndex,
      wordIndex: startingWordIndex + w,
    });
  }

  return result;
}

/**
 * Builds a complete `ChunkAlignment` object from audio samples (or sample count) and sample rate.
 * Prefers exact model-predicted `durations` + `tokens` from `Kokoro-82M-v1.0-ONNX-timestamped`
 * or `Paradee-8M-v1.3` when available, falling back to waveform onset/offset alignment or
 * character-proportional estimation.
 */
export function buildChunkAlignment(params: {
  chunkIndex: number;
  span: TextChunkSpan;
  samples?: Float32Array;
  tokens?: readonly string[];
  durations?: ArrayLike<number>;
  wordTokenSpans?: ReadonlyArray<WordTokenSpan | null>;
  chunkSamples: number;
  totalSamplesBeforeChunk: number;
  sampleRate: number;
  startingWordIndex: number;
}): ChunkAlignment {
  const {
    chunkIndex,
    span,
    samples,
    tokens,
    durations,
    wordTokenSpans,
    chunkSamples,
    totalSamplesBeforeChunk,
    sampleRate,
    startingWordIndex,
  } = params;

  const chunkDurationSeconds =
    sampleRate > 0 ? chunkSamples / sampleRate : 0;
  const chunkOffsetSeconds =
    sampleRate > 0 ? totalSamplesBeforeChunk / sampleRate : 0;

  const startMs = Math.round(chunkOffsetSeconds * 1000);
  const endMs = Math.round((chunkOffsetSeconds + chunkDurationSeconds) * 1000);
  const words =
    tokens &&
    durations &&
    tokens.length > 0 &&
    durations.length === tokens.length
      ? buildDurationWordAlignmentData(
          span.text,
          tokens,
          durations,
          chunkSamples,
          sampleRate,
          chunkOffsetSeconds,
          {
            chunkCharStart: span.charStart,
            chunkIndex,
            startingWordIndex,
            samples,
            wordTokenSpans,
          },
        )
      : samples && samples.length > 0
        ? buildWaveformWordAlignmentData(
            span.text,
            samples,
            sampleRate,
            chunkOffsetSeconds,
            {
              chunkCharStart: span.charStart,
              chunkIndex,
              startingWordIndex,
            },
          )
        : buildWordAlignmentData(
            span.text,
            chunkDurationSeconds,
            chunkOffsetSeconds,
            {
              chunkCharStart: span.charStart,
              chunkIndex,
              startingWordIndex,
            },
          );

  return {
    chunkIndex,
    text: span.text,
    charStart: span.charStart,
    charEnd: span.charEnd,
    startMs,
    endMs,
    durationMs: Math.max(0, endMs - startMs),
    words,
  };
}

/**
 * Finds the active word within a playing chunk for a given `playbackTimeMs`.
 * Waits during leading sentence silence until just before the first word's onset,
 * and keeps the preceding word highlighted across brief inter-word single-space gaps
 * so word highlighting transitions smoothly without 40ms flicker on spaces.
 */
export function findActiveWordInChunk(
  chunk: ChunkAlignment,
  playbackTimeMs: number,
): WordTimestamp | null {
  const { words } = chunk;
  if (words.length === 0) return null;

  if (playbackTimeMs < words[0].startMs) {
    return words[0].startMs - playbackTimeMs <= 60 ? words[0] : null;
  }

  let low = 0;
  let high = words.length - 1;
  let candidateIndex = 0;

  while (low <= high) {
    const mid = (low + high) >> 1;
    if (words[mid].startMs <= playbackTimeMs) {
      candidateIndex = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return words[candidateIndex] ?? null;
}
