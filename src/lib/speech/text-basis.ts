import { articleHtmlToReaderBlocks } from "@/lib/content-pipeline";

export type NarrationTextBasis =
  | { kind: "full" }
  | { kind: "character-limit"; maxChars: number }
  | { kind: "paragraph-limit"; maxChars: number };

export type PreparedNarrationText = {
  plainText: string;
  blocks: string[];
  basis: NarrationTextBasis;
};

export const REALTIME_NARRATION_TEXT_BASIS: NarrationTextBasis = {
  kind: "character-limit",
  maxChars: 5_000,
};

const FULL_NARRATION_TEXT_BASIS: NarrationTextBasis = { kind: "full" };

export function batchNarrationTextBasis(
  maxChars: number | null,
): NarrationTextBasis {
  return maxChars
    ? { kind: "paragraph-limit", maxChars }
    : FULL_NARRATION_TEXT_BASIS;
}

export function prepareNarrationText(
  articleHtml: string,
  basis: NarrationTextBasis,
): PreparedNarrationText {
  const readerText = articleHtmlToReaderBlocks(articleHtml);
  if (basis.kind === "full") {
    return { ...readerText, basis };
  }
  if (basis.kind === "character-limit") {
    const plainText = readerText.plainText.slice(0, basis.maxChars);
    return { plainText, blocks: plainText ? [plainText] : [], basis };
  }

  const blocks = capParagraphs(readerText.blocks, basis.maxChars);
  return { plainText: blocks.join(" "), blocks, basis };
}

export function resolveStoredNarrationTextBasis(
  basis: NarrationTextBasis | undefined,
  provider: string,
): NarrationTextBasis {
  if (basis) return basis;
  return provider === "azure-batch"
    ? FULL_NARRATION_TEXT_BASIS
    : REALTIME_NARRATION_TEXT_BASIS;
}

function capParagraphs(paragraphs: string[], maxChars: number): string[] {
  const capped: string[] = [];
  let remaining = maxChars;
  for (const paragraph of paragraphs) {
    if (remaining <= 0) break;
    if (paragraph.length <= remaining) {
      capped.push(paragraph);
      remaining -= paragraph.length;
      continue;
    }
    capped.push(paragraph.slice(0, remaining).trim());
    break;
  }
  return capped.filter(Boolean);
}