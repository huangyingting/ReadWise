import type { Highlight as RwHighlight } from "@/components/ReaderHighlightsProvider";

export type TextNodeEntry = { node: Text; start: number; end: number };

const ANCHOR_CONTEXT_CHARS = 32;

type AnchorResult = {
  quote: string;
  startOffset: number;
  endOffset: number;
  prefix: string;
  suffix: string;
};

type ResolvedHighlight = { hl: RwHighlight; start: number; end: number };
type HighlightSegment = {
  tnIdx: number;
  from: number;
  to: number;
  hl: RwHighlight;
  isFirst: boolean;
};

function scoreContext(actual: string, expected: string): number {
  if (!expected) return 0;
  if (actual === expected) return 2;
  if (actual.includes(expected) || expected.includes(actual)) return 1;
  return 0;
}

export function findBestAnchor(
  fullText: string,
  quote: string,
  prefix: string,
  suffix: string,
): number {
  if (!quote) return -1;
  let bestIdx = -1;
  let bestScore = -1;
  let searchFrom = 0;
  while (true) {
    const idx = fullText.indexOf(quote, searchFrom);
    if (idx === -1) break;
    const ap = fullText.slice(Math.max(0, idx - prefix.length), idx);
    const as_ = fullText.slice(idx + quote.length, idx + quote.length + suffix.length);
    const score = scoreContext(ap, prefix) + scoreContext(as_, suffix);
    if (score > bestScore) { bestScore = score; bestIdx = idx; }
    searchFrom = idx + 1;
  }
  return bestIdx;
}

export function computeAnchor(
  proseEl: HTMLElement,
  sel: Selection,
): AnchorResult | null {
  if (sel.isCollapsed || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  const quote = sel.toString().trim();
  if (!quote) return null;
  const preRange = range.cloneRange();
  preRange.selectNodeContents(proseEl);
  preRange.setEnd(range.startContainer, range.startOffset);
  const startOffset = preRange.toString().length;
  const endOffset = startOffset + quote.length;
  const fullText = proseEl.textContent ?? "";
  const prefix = fullText.slice(Math.max(0, startOffset - ANCHOR_CONTEXT_CHARS), startOffset);
  const suffix = fullText.slice(
    endOffset,
    Math.min(fullText.length, endOffset + ANCHOR_CONTEXT_CHARS),
  );
  return { quote, startOffset, endOffset, prefix, suffix };
}

export function collectTextNodes(container: HTMLElement): TextNodeEntry[] {
  const entries: TextNodeEntry[] = [];
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let offset = 0;
  let n: Node | null;
  while ((n = walker.nextNode())) {
    const tn = n as Text;
    entries.push({ start: offset, end: offset + tn.length, node: tn });
    offset += tn.length;
  }
  return entries;
}

function createMarkElement(hl: RwHighlight, isFirstSegment: boolean): HTMLElement {
  const mark = document.createElement("mark");
  mark.className = "rw-hl";
  mark.dataset.hlId = hl.id;
  mark.dataset.hlColor = hl.color ?? "yellow";
  if (hl.note) {
    mark.dataset.hlHasNote = "true";
    if (isFirstSegment) {
      const sr = document.createElement("span");
      sr.className = "sr-only";
      sr.textContent = "(has note)";
      mark.appendChild(sr);
    }
  }
  return mark;
}

function unwrapExistingMarks(container: HTMLElement): void {
  for (const mark of Array.from(container.querySelectorAll<HTMLElement>("mark.rw-hl"))) {
    mark.replaceWith(...Array.from(mark.childNodes));
  }
  container.normalize();
}

function resolveHighlight(
  fullText: string,
  hl: RwHighlight,
  onOrphaned: (id: string) => void,
): ResolvedHighlight | null {
  let start = hl.startOffset;
  let end = hl.endOffset;
  if (fullText.slice(start, end) !== hl.quote) {
    const found = findBestAnchor(fullText, hl.quote, hl.prefix, hl.suffix);
    if (found === -1) {
      onOrphaned(hl.id);
      return null;
    }
    start = found;
    end = found + hl.quote.length;
  }
  return { hl, start, end };
}

function resolveHighlights(
  fullText: string,
  highlights: RwHighlight[],
  onOrphaned: (id: string) => void,
): ResolvedHighlight[] {
  return highlights
    .map((hl) => resolveHighlight(fullText, hl, onOrphaned))
    .filter((hl): hl is ResolvedHighlight => hl !== null)
    .sort((a, b) => a.start - b.start);
}

function buildHighlightSegments(
  textNodes: TextNodeEntry[],
  resolved: ResolvedHighlight[],
): HighlightSegment[] {
  const segments: HighlightSegment[] = [];
  const seenHlIds = new Set<string>();

  for (let ti = 0; ti < textNodes.length; ti++) {
    const tn = textNodes[ti];
    for (const r of resolved) {
      if (r.end <= tn.start || r.start >= tn.end) continue;
      const isFirst = !seenHlIds.has(r.hl.id);
      if (isFirst) seenHlIds.add(r.hl.id);
      segments.push({
        tnIdx: ti,
        from: Math.max(r.start - tn.start, 0),
        to: Math.min(r.end - tn.start, tn.end - tn.start),
        hl: r.hl,
        isFirst,
      });
    }
  }

  return segments.sort((a, b) => b.tnIdx - a.tnIdx || b.from - a.from);
}

function wrapHighlightSegment(textNodes: TextNodeEntry[], seg: HighlightSegment): void {
  const tn = textNodes[seg.tnIdx].node;
  if (!tn.parentNode) return;
  if (seg.from < 0 || seg.from >= seg.to) return;
  if (seg.from > tn.length) return;

  const mark = createMarkElement(seg.hl, seg.isFirst);
  const target = tn.splitText(seg.from);
  const clampedLen = Math.min(seg.to - seg.from, target.length);
  if (clampedLen < target.length) target.splitText(clampedLen);
  target.parentNode!.insertBefore(mark, target);
  mark.appendChild(target);
}

export function applyHighlightMarks(
  container: HTMLElement,
  highlights: RwHighlight[],
  onOrphaned: (id: string) => void,
): void {
  unwrapExistingMarks(container);

  if (highlights.length === 0) return;

  const fullText = container.textContent ?? "";
  const resolved = resolveHighlights(fullText, highlights, onOrphaned);
  if (resolved.length === 0) return;

  const textNodes = collectTextNodes(container);
  for (const seg of buildHighlightSegments(textNodes, resolved)) {
    wrapHighlightSegment(textNodes, seg);
  }
}

export function overlapsAny(start: number, end: number, highlights: RwHighlight[]): RwHighlight[] {
  return highlights.filter(
    (h) => !h.id.startsWith("optimistic-") && h.startOffset < end && h.endOffset > start,
  );
}
