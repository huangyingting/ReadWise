import type { Highlight as RwHighlight } from "@/components/ReaderHighlightsProvider";

export type TextNodeEntry = { node: Text; start: number; end: number };

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
    let score = 0;
    if (prefix && ap === prefix) score += 2;
    else if (prefix && (ap.includes(prefix) || prefix.includes(ap))) score += 1;
    if (suffix && as_ === suffix) score += 2;
    else if (suffix && (as_.includes(suffix) || suffix.includes(as_))) score += 1;
    if (score > bestScore) { bestScore = score; bestIdx = idx; }
    searchFrom = idx + 1;
  }
  return bestIdx;
}

export function computeAnchor(
  proseEl: HTMLElement,
  sel: Selection,
): { quote: string; startOffset: number; endOffset: number; prefix: string; suffix: string } | null {
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
  const prefix = fullText.slice(Math.max(0, startOffset - 32), startOffset);
  const suffix = fullText.slice(endOffset, Math.min(fullText.length, endOffset + 32));
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

export function applyHighlightMarks(
  container: HTMLElement,
  highlights: RwHighlight[],
  onOrphaned: (id: string) => void,
): void {
  for (const mark of Array.from(container.querySelectorAll<HTMLElement>("mark.rw-hl"))) {
    mark.replaceWith(...Array.from(mark.childNodes));
  }
  container.normalize();

  if (highlights.length === 0) return;

  const fullText = container.textContent ?? "";
  type Resolved = { hl: RwHighlight; start: number; end: number };
  const resolved: Resolved[] = [];
  for (const hl of highlights) {
    let start = hl.startOffset;
    let end = hl.endOffset;
    if (fullText.slice(start, end) !== hl.quote) {
      const found = findBestAnchor(fullText, hl.quote, hl.prefix, hl.suffix);
      if (found === -1) { onOrphaned(hl.id); continue; }
      start = found;
      end = found + hl.quote.length;
    }
    resolved.push({ hl, start, end });
  }
  if (resolved.length === 0) return;
  resolved.sort((a, b) => a.start - b.start);

  const textNodes = collectTextNodes(container);
  interface Segment { tnIdx: number; from: number; to: number; hl: RwHighlight; isFirst: boolean }
  const segments: Segment[] = [];
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

  segments.sort((a, b) => b.tnIdx - a.tnIdx || b.from - a.from);
  for (const seg of segments) {
    const tn = textNodes[seg.tnIdx].node;
    if (!tn.parentNode) continue;
    if (seg.from < 0 || seg.from >= seg.to) continue;
    if (seg.from > tn.length) continue;
    const mark = createMarkElement(seg.hl, seg.isFirst);
    const target = tn.splitText(seg.from);
    const clampedLen = Math.min(seg.to - seg.from, target.length);
    if (clampedLen < target.length) target.splitText(clampedLen);
    target.parentNode!.insertBefore(mark, target);
    mark.appendChild(target);
  }
}

export function overlapsAny(start: number, end: number, highlights: RwHighlight[]): RwHighlight[] {
  return highlights.filter(
    (h) => !h.id.startsWith("optimistic-") && h.startOffset < end && h.endOffset > start,
  );
}
