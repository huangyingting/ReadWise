/**
 * Pure helpers that adapt on-device synthesis output to the Reader's
 * existing narration contract (`SpeechWord` timings with `plainText`
 * offsets, played from one `<audio>` element).
 */
import type { SpeechWord } from "@/lib/speech/timing";
import type { WordTimestamp } from "./types";

const SPOKEN_CHAR = /[\p{L}\p{N}]/u;

/**
 * Converts whitespace-delimited aligned words into Reader speech words.
 * Leading/trailing punctuation is trimmed from the highlighted span (so
 * `"China."` highlights `China`), and punctuation-only tokens are dropped.
 */
export function toSpeechWords(words: readonly WordTimestamp[]): SpeechWord[] {
  const result: SpeechWord[] = [];
  for (const word of words) {
    const chars = Array.from(word.text);
    let lead = 0;
    while (lead < chars.length && !SPOKEN_CHAR.test(chars[lead]!)) lead++;
    let trail = chars.length;
    while (trail > lead && !SPOKEN_CHAR.test(chars[trail - 1]!)) trail--;
    if (lead >= trail) continue;

    const leadUnits = chars.slice(0, lead).join("").length;
    const trailUnits = chars.slice(trail).join("").length;
    result.push({
      word: chars.slice(lead, trail).join(""),
      startMs: word.startMs,
      endMs: Math.max(word.startMs, word.endMs),
      textStart: word.charStart + leadUnits,
      textEnd: word.charEnd - trailUnits,
    });
  }
  return result;
}

/** Converts float samples in [-1, 1] to 16-bit PCM. */
export function floatToPcm16(samples: Float32Array): Int16Array {
  const pcm = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i] ?? 0));
    pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return pcm;
}

/** Builds a mono 16-bit PCM WAV blob from PCM chunks without copying them. */
export function encodeWav(chunks: readonly Int16Array[], sampleRate: number): Blob {
  const dataBytes = chunks.reduce((acc, chunk) => acc + chunk.byteLength, 0);
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const writeAscii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true); // PCM fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeAscii(36, "data");
  view.setUint32(40, dataBytes, true);
  return new Blob([header, ...chunks.map((chunk) => chunk.buffer as ArrayBuffer)], { type: "audio/wav" });
}
