"use client";

/**
 * WordLookup (M11 — highlights + M1 dictionary, combined)
 *
 * ONE floating surface is open at a time, chosen by gesture:
 *
 *   Gesture                   | Surface
 *   ─────────────────────────────────────────────────────────
 *   Click/tap a word           | Dictionary popover (unchanged)
 *   Click a <mark.rw-hl>       | Highlight edit popover (new)
 *   Drag-select text           | Selection toolbar (new)
 *   Cmd/Ctrl+E w/ selection    | Selection toolbar (keyboard a11y)
 *
 * The mark renderer (useEffect) walks text nodes via TreeWalker to wrap
 * matching ranges in <mark class="rw-hl">. It NEVER re-sanitizes or
 * sets innerHTML — it operates on the existing, already-sanitized nodes.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DictionaryResult } from "@/lib/dictionary";
import type { SupportedLanguage } from "@/lib/supported-languages";
import { getTranslateLang, setTranslateLang } from "@/lib/translate-lang";
import {
  useHighlights,
  type Highlight as RwHighlight,
  type HighlightColor,
} from "./ReaderHighlightsProvider";
import { useReaderAudio } from "./ReaderAudioProvider";
import SelectionToolbar from "./SelectionToolbar";
import HighlightEditPopover from "./HighlightEditPopover";
import SentenceTranslatePopover, {
  type TranslateSentenceResult,
} from "./SentenceTranslatePopover";

const POPOVER_WIDTH = 340;
const POPOVER_HEIGHT = 380;
const MINI_PLAYER_HEIGHT = 56;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function wordAtPoint(x: number, y: number): string | null {
  const doc = document as Document & {
    caretPositionFromPoint?: (
      x: number,
      y: number,
    ) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };

  let node: Node | null = null;
  let offset = 0;

  if (typeof doc.caretRangeFromPoint === "function") {
    const range = doc.caretRangeFromPoint(x, y);
    if (range) { node = range.startContainer; offset = range.startOffset; }
  } else if (typeof doc.caretPositionFromPoint === "function") {
    const pos = doc.caretPositionFromPoint(x, y);
    if (pos) { node = pos.offsetNode; offset = pos.offset; }
  }

  if (!node || node.nodeType !== Node.TEXT_NODE) return null;

  const text = node.textContent ?? "";
  const isWordChar = (c: string) => /[A-Za-z'''-]/.test(c);
  let start = Math.min(offset, text.length);
  let end = start;
  while (start > 0 && isWordChar(text[start - 1])) start--;
  while (end < text.length && isWordChar(text[end])) end++;
  return text.slice(start, end).trim() || null;
}

function findBestAnchor(
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

function computeAnchor(
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

// ---------------------------------------------------------------------------
// Mark renderer
// ---------------------------------------------------------------------------

type TextNodeEntry = { node: Text; start: number; end: number };

function collectTextNodes(container: HTMLElement): TextNodeEntry[] {
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

// ---------------------------------------------------------------------------
// TTS prose word map
// ---------------------------------------------------------------------------

type ProseWord = { node: Text; start: number; end: number };

/**
 * Walks the prose container's text nodes and returns a flat array of
 * non-whitespace token positions. The N-th entry corresponds to the N-th
 * word fired by the Azure Speech SDK (word-walk alignment — pragmatic, not
 * offset-exact). Rebuilt whenever highlight marks change text node structure.
 */
function buildProseWordMap(container: HTMLElement): ProseWord[] {
  const result: ProseWord[] = [];
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let n: Node | null;
  while ((n = walker.nextNode())) {
    const text = n as Text;
    const content = text.textContent ?? "";
    const re = /\S+/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      result.push({ node: text, start: m.index, end: m.index + m[0].length });
    }
  }
  return result;
}

// Typed accessor for the CSS Custom Highlight API (TS lib.dom only types
// forEach; the actual Map-like interface has set/delete too).
type CssHighlightRegistry = { set(k: string, v: Highlight): void; delete(k: string): void };

function createMarkElement(hl: RwHighlight): HTMLElement {
  const mark = document.createElement("mark");
  mark.className = "rw-hl";
  mark.dataset.hlId = hl.id;
  mark.dataset.hlColor = hl.color ?? "yellow";
  if (hl.note) {
    mark.dataset.hlHasNote = "true";
    const sr = document.createElement("span");
    sr.className = "sr-only";
    sr.textContent = "(has note)";
    mark.appendChild(sr);
  }
  return mark;
}

function applyHighlightMarks(
  container: HTMLElement,
  highlights: RwHighlight[],
  onOrphaned: (id: string) => void,
): void {
  // 1. Remove existing marks
  for (const mark of Array.from(container.querySelectorAll<HTMLElement>("mark.rw-hl"))) {
    mark.replaceWith(...Array.from(mark.childNodes));
  }
  container.normalize();

  if (highlights.length === 0) return;

  const fullText = container.textContent ?? "";

  // 2. Resolve anchors
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

  // 3. Build segments
  const textNodes = collectTextNodes(container);
  interface Segment { tnIdx: number; from: number; to: number; hl: RwHighlight }
  const segments: Segment[] = [];
  for (let ti = 0; ti < textNodes.length; ti++) {
    const tn = textNodes[ti];
    for (const r of resolved) {
      if (r.end <= tn.start || r.start >= tn.end) continue;
      segments.push({
        tnIdx: ti,
        from: Math.max(r.start - tn.start, 0),
        to: Math.min(r.end - tn.start, tn.end - tn.start),
        hl: r.hl,
      });
    }
  }

  // 4. Apply in REVERSE (last-in-document first) to preserve earlier offsets
  segments.sort((a, b) => b.tnIdx - a.tnIdx || b.from - a.from);
  for (const seg of segments) {
    const tn = textNodes[seg.tnIdx].node;
    if (!tn.parentNode) continue;
    // Guard: seg.from may exceed tn.length if overlapping highlights caused
    // earlier splits to shorten the node — skip rather than throw IndexSizeError.
    if (seg.from < 0 || seg.from >= seg.to) continue;
    if (seg.from > tn.length) continue;
    const mark = createMarkElement(seg.hl);
    const target = tn.splitText(seg.from);
    const clampedLen = Math.min(seg.to - seg.from, target.length);
    if (clampedLen < target.length) target.splitText(clampedLen);
    target.parentNode!.insertBefore(mark, target);
    mark.appendChild(target);
  }
}

// ---------------------------------------------------------------------------
// Overlap helpers
// ---------------------------------------------------------------------------

function overlapsAny(start: number, end: number, highlights: RwHighlight[]): RwHighlight[] {
  return highlights.filter(
    (h) => !h.id.startsWith("optimistic-") && h.startOffset < end && h.endOffset > start,
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type OpenSurface = "dictionary" | "toolbar" | "popover" | "translate" | null;

interface SavedAnchor {
  quote: string;
  startOffset: number;
  endOffset: number;
  prefix: string;
  suffix: string;
  selectionWord: string;
}

export default function WordLookup({
  html,
  articleId,
  languages,
}: {
  html: string;
  articleId: string;
  languages: SupportedLanguage[];
}) {
  const proseRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const editPopoverRef = useRef<HTMLDivElement>(null);
  const translatePopoverRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // Guards stale in-flight translate requests (increment on each new request)
  const translateReqRef = useRef(0);

  const [openSurface, setOpenSurface] = useState<OpenSurface>(null);

  // Dictionary
  const [dictAnchor, setDictAnchor] = useState<{ x: number; y: number } | null>(null);
  const [word, setWord] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<DictionaryResult | null>(null);
  const [dictError, setDictError] = useState<string | null>(null);

  // Toolbar
  const [toolbarRect, setToolbarRect] = useState<DOMRect | null>(null);
  const [toolbarColor, setToolbarColor] = useState<HighlightColor>("yellow");
  const [toolbarShowDefine, setToolbarShowDefine] = useState(false);
  const savedAnchorRef = useRef<SavedAnchor | null>(null);

  // Edit popover
  const [editHlId, setEditHlId] = useState<string | null>(null);
  const [editMarkEl, setEditMarkEl] = useState<HTMLElement | null>(null);

  // Sentence translation (M13)
  const [translateLang, setTranslateLangState] = useState<string>("zh-Hans");
  const [translateLoading, setTranslateLoading] = useState(false);
  const [translateResult, setTranslateResult] = useState<TranslateSentenceResult | null>(null);
  const [translateError, setTranslateError] = useState<string | null>(null);
  const [translateText, setTranslateText] = useState<string>("");
  const [translateSelectionRect, setTranslateSelectionRect] = useState<DOMRect | null>(null);

  const { highlights, add, updateColor, updateNote, remove, markOrphaned } = useHighlights();
  const editHighlight = editHlId ? (highlights.find((h) => h.id === editHlId) ?? null) : null;

  // TTS prose highlighting
  const readerAudio = useReaderAudio();
  const ttsWordMapRef = useRef<ProseWord[]>([]);

  const closeAll = useCallback(() => {
    setOpenSurface(null);
    setDictAnchor(null);
    setToolbarRect(null);
    setEditHlId(null);
    setEditMarkEl(null);
    savedAnchorRef.current = null;
    setResult(null);
    setDictError(null);
    setLoading(false);
    // M13: reset translate state (translateLang is NOT reset — it's persisted)
    setTranslateLoading(false);
    setTranslateResult(null);
    setTranslateError(null);
    setTranslateSelectionRect(null);
    setTranslateText("");
  }, []);

  // Mark rendering
  useEffect(() => {
    if (!proseRef.current) return;
    applyHighlightMarks(proseRef.current, highlights, markOrphaned);
  }, [highlights, markOrphaned]);

  // Rebuild the TTS word map after highlight marks are (re-)applied, since
  // applyHighlightMarks splits/normalises text nodes. Must run AFTER the
  // effect above (React executes effects in definition order).
  useEffect(() => {
    if (!proseRef.current || readerAudio.words.length === 0) {
      ttsWordMapRef.current = [];
      return;
    }
    ttsWordMapRef.current = buildProseWordMap(proseRef.current);
  }, [readerAudio.words.length, highlights]);

  // Apply / clear the TTS active-word highlight in the main prose using the
  // CSS Custom Highlight API (graceful degradation — no highlight on unsupported
  // browsers, audio keeps playing). Auto-scroll is gated on listenActive so
  // background playback never hijacks the user's reading position.
  useEffect(() => {
    const cssh =
      typeof CSS !== "undefined" && "highlights" in CSS
        ? (CSS.highlights as unknown as CssHighlightRegistry)
        : null;
    if (!cssh) return;

    const idx = readerAudio.activeIndex;
    const map = ttsWordMapRef.current;
    if (idx < 0 || idx >= map.length) {
      cssh.delete("tts-active");
      return;
    }

    const { node, start, end } = map[idx];
    let range: Range;
    try {
      range = new Range();
      range.setStart(node, start);
      range.setEnd(node, Math.min(end, node.length));
    } catch {
      cssh.delete("tts-active");
      return;
    }
    cssh.set("tts-active", new Highlight(range));

    if (readerAudio.listenActive) {
      const rects = range.getClientRects();
      if (rects.length > 0) {
        const rect = rects[0];
        const viewTop = window.innerHeight * 0.2;
        const viewBottom = window.innerHeight * 0.75;
        if (rect.top < viewTop || rect.bottom > viewBottom) {
          node.parentElement?.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }
    }

    return () => {
      cssh.delete("tts-active");
    };
  }, [readerAudio.activeIndex, readerAudio.listenActive]);

  // Seed translate language from localStorage after mount
  useEffect(() => {
    const stored = getTranslateLang();
    setTranslateLangState(stored);
  }, []);

  // Dictionary lookup
  const runLookup = useCallback(async (term: string) => {
    setLoading(true);
    setDictError(null);
    setResult(null);
    try {
      const res = await fetch("/api/dictionary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ word: term }),
      });
      if (!res.ok) throw new Error("Lookup failed");
      setResult((await res.json()) as DictionaryResult);
    } catch {
      setDictError("Could not look up this word. Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  const openDictionary = useCallback(
    (candidate: string, clientX: number, clientY: number) => {
      const left = Math.max(12, Math.min(clientX, window.innerWidth - POPOVER_WIDTH - 12));
      const safeBottom = window.innerHeight - MINI_PLAYER_HEIGHT - POPOVER_HEIGHT - 12;
      const top = Math.max(12, clientY > safeBottom ? clientY - POPOVER_HEIGHT - 12 : clientY + 12);
      setDictAnchor({ x: left, y: top });
      setWord(candidate);
      setOpenSurface("dictionary");
      void runLookup(candidate);
    },
    [runLookup],
  );

  // Main selection handler
  const handleSelect = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const sel = window.getSelection();
      const isCollapsed = !sel || sel.isCollapsed;

      if (!isCollapsed && sel && sel.rangeCount > 0) {
        const prose = proseRef.current;
        if (!prose) return;
        const anchor = computeAnchor(prose, sel);
        if (!anchor) return;
        const rect = sel.getRangeAt(0).getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) return;
        const isSingleWord = /^\s*[A-Za-z''-]+\s*$/.test(anchor.quote);
        savedAnchorRef.current = { ...anchor, selectionWord: anchor.quote.trim().split(/\s+/)[0] ?? "" };
        const stored = typeof window !== "undefined" ? localStorage.getItem("readwise:last-hl-color") : null;
        if (stored && ["yellow", "green", "blue", "pink"].includes(stored)) setToolbarColor(stored as HighlightColor);
        setToolbarRect(rect);
        setToolbarShowDefine(isSingleWord);
        setOpenSurface("toolbar");
        return;
      }

      const target = e.target as Element;
      const markEl = target.closest<HTMLElement>("mark.rw-hl");
      if (markEl?.dataset.hlId) {
        closeAll();
        setEditHlId(markEl.dataset.hlId);
        setEditMarkEl(markEl);
        setOpenSurface("popover");
        return;
      }

      let candidate = wordAtPoint(e.clientX, e.clientY) ?? "";
      candidate = candidate.replace(/^[^A-Za-z'']+|[^A-Za-z'']+$/g, "");
      if (!candidate || !/[A-Za-z]/.test(candidate)) return;
      closeAll();
      openDictionary(candidate, e.clientX, e.clientY);
    },
    [closeAll, openDictionary],
  );

  // Cmd/Ctrl+E keyboard summon
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key !== "e") return;
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
      const prose = proseRef.current;
      if (!prose || !prose.contains(sel.anchorNode)) return;
      e.preventDefault();
      const anchor = computeAnchor(prose, sel);
      if (!anchor) return;
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      const isSingleWord = /^\s*[A-Za-z''-]+\s*$/.test(anchor.quote);
      savedAnchorRef.current = { ...anchor, selectionWord: anchor.quote.trim().split(/\s+/)[0] ?? "" };
      setToolbarRect(rect);
      setToolbarShowDefine(isSingleWord);
      setOpenSurface("toolbar");
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // selectionchange → dismiss toolbar when selection collapses
  useEffect(() => {
    if (openSurface !== "toolbar") return;
    let timer: ReturnType<typeof setTimeout>;
    const onSelChange = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const s = window.getSelection();
        if (!s || s.isCollapsed) setOpenSurface((v) => (v === "toolbar" ? null : v));
      }, 120);
    };
    document.addEventListener("selectionchange", onSelChange);
    return () => { clearTimeout(timer); document.removeEventListener("selectionchange", onSelChange); };
  }, [openSurface]);

  // Outside-click / Escape
  useEffect(() => {
    if (!openSurface) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (
        popoverRef.current?.contains(t) ||
        toolbarRef.current?.contains(t) ||
        editPopoverRef.current?.contains(t) ||
        translatePopoverRef.current?.contains(t) ||
        proseRef.current?.contains(t)
      ) return;
      closeAll();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); closeAll(); proseRef.current?.focus(); }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [openSurface, closeAll]);

  // Toolbar: create highlight
  const handleHighlight = useCallback(async () => {
    const saved = savedAnchorRef.current;
    const prose = proseRef.current;
    if (!saved || !prose) return;
    const color = toolbarColor;
    localStorage.setItem("readwise:last-hl-color", color);
    window.getSelection()?.removeAllRanges();
    const { quote, startOffset, endOffset, prefix, suffix } = saved;
    const overlapping = overlapsAny(startOffset, endOffset, highlights);
    if (overlapping.length > 0) {
      const fullText = prose.textContent ?? "";
      const ns = Math.min(startOffset, ...overlapping.map((h) => h.startOffset));
      const ne = Math.max(endOffset, ...overlapping.map((h) => h.endOffset));
      const mergedNote = overlapping.filter((h) => h.note).sort((a, b) => a.startOffset - b.startOffset)[0]?.note ?? null;
      for (const h of overlapping) await remove(h.id);
      await add({ quote: fullText.slice(ns, ne), startOffset: ns, endOffset: ne,
        prefix: fullText.slice(Math.max(0, ns - 32), ns),
        suffix: fullText.slice(ne, Math.min(fullText.length, ne + 32)),
        color, note: mergedNote ?? undefined });
    } else {
      await add({ quote, startOffset, endOffset, prefix, suffix, color });
    }
    closeAll();
  }, [toolbarColor, highlights, add, remove, closeAll]);

  // Toolbar: add note
  const handleAddNote = useCallback(async () => {
    const saved = savedAnchorRef.current;
    if (!saved) return;
    const color = toolbarColor;
    localStorage.setItem("readwise:last-hl-color", color);
    window.getSelection()?.removeAllRanges();
    setOpenSurface(null);
    setToolbarRect(null);
    const { quote, startOffset, endOffset, prefix, suffix } = saved;
    const overlapping = overlapsAny(startOffset, endOffset, highlights);
    let newHl: RwHighlight | null = null;
    if (overlapping.length > 0) {
      const fullText = proseRef.current?.textContent ?? "";
      const ns = Math.min(startOffset, ...overlapping.map((h) => h.startOffset));
      const ne = Math.max(endOffset, ...overlapping.map((h) => h.endOffset));
      for (const h of overlapping) await remove(h.id);
      newHl = await add({ quote: fullText.slice(ns, ne), startOffset: ns, endOffset: ne,
        prefix: fullText.slice(Math.max(0, ns - 32), ns),
        suffix: fullText.slice(ne, Math.min(fullText.length, ne + 32)), color });
    } else {
      newHl = await add({ quote, startOffset, endOffset, prefix, suffix, color });
    }
    if (newHl) {
      const hlId = newHl.id;
      setTimeout(() => {
        const markEl = document.querySelector<HTMLElement>(`mark.rw-hl[data-hl-id="${hlId}"]`);
        if (markEl) { setEditHlId(hlId); setEditMarkEl(markEl); setOpenSurface("popover"); }
      }, 80);
    }
  }, [toolbarColor, highlights, add, remove]);

  // Toolbar: define
  const handleDefine = useCallback(() => {
    const saved = savedAnchorRef.current;
    if (!saved) return;
    let candidate = saved.selectionWord.replace(/^[^A-Za-z'']+|[^A-Za-z'']+$/g, "").trim();
    if (!candidate || !/[A-Za-z]/.test(candidate)) return;
    closeAll();
    window.getSelection()?.removeAllRanges();
    openDictionary(candidate, window.innerWidth / 2, window.innerHeight / 2);
  }, [closeAll, openDictionary]);

  // Toolbar: sentence translate (M13)
  const runSentenceTranslate = useCallback(async (text: string, lang: string) => {
    const reqId = ++translateReqRef.current;
    setTranslateLoading(true);
    setTranslateResult(null);
    setTranslateError(null);
    try {
      const res = await fetch(`/api/reader/${articleId}/translate-sentence`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, lang }),
      });
      if (translateReqRef.current !== reqId) return;
      if (!res.ok) throw new Error("Translation failed");
      const data = (await res.json()) as TranslateSentenceResult;
      if (translateReqRef.current !== reqId) return;
      setTranslateResult(data);
    } catch {
      if (translateReqRef.current !== reqId) return;
      setTranslateError("Couldn't translate that. Try again.");
    } finally {
      if (translateReqRef.current === reqId) setTranslateLoading(false);
    }
  }, [articleId]);

  const handleTranslate = useCallback(() => {
    const saved = savedAnchorRef.current;
    const rect = toolbarRect;
    if (!saved || !rect) return;
    const text = saved.quote;
    if (!text.trim()) return;
    // Transition from toolbar → translate surface (does NOT call closeAll, preserving state)
    setTranslateText(text);
    setTranslateSelectionRect(rect);
    setOpenSurface("translate");
    setToolbarRect(null);
    void runSentenceTranslate(text, translateLang);
  }, [toolbarRect, translateLang, runSentenceTranslate]);

  const handleTranslateLangChange = useCallback((lang: string) => {
    setTranslateLangState(lang);
    setTranslateLang(lang); // persist to localStorage (shared with M5 tab)
    if (translateText) {
      void runSentenceTranslate(translateText, lang);
    }
  }, [translateText, runSentenceTranslate]);

  const handleTranslateRetry = useCallback(() => {
    if (translateText) {
      void runSentenceTranslate(translateText, translateLang);
    }
  }, [translateText, translateLang, runSentenceTranslate]);

  // Edit popover
  const handleEditColorChange = useCallback((color: HighlightColor) => {
    if (!editHlId) return;
    void updateColor(editHlId, color);
  }, [editHlId, updateColor]);

  const handleEditNoteSave = useCallback((note: string | null) => {
    if (!editHlId) return;
    void updateNote(editHlId, note);
  }, [editHlId, updateNote]);

  const handleEditDelete = useCallback(async () => {
    if (!editHlId) return;
    await remove(editHlId);
    closeAll();
  }, [editHlId, remove, closeAll]);

  function playAudio(src: string) {
    audioRef.current?.pause();
    const audio = new Audio(src);
    audioRef.current = audio;
    void audio.play().catch(() => {});
  }

  // Stable object reference for dangerouslySetInnerHTML — React 19 uses reference
  // equality to decide whether to reset innerHTML; recreating the object inline on
  // every render would wipe highlight <mark> nodes added by applyHighlightMarks.
  const innerHtml = useMemo(() => ({ __html: html }), [html]);

  return (
    <>
      <div
        ref={proseRef}
        className="prose word-lookup-prose"
        tabIndex={-1}
        onMouseUp={handleSelect}
        dangerouslySetInnerHTML={innerHtml}
      />

      {/* Dictionary popover */}
      {openSurface === "dictionary" && dictAnchor ? (
        <div
          ref={popoverRef}
          className="word-lookup-popover"
          role="dialog"
          aria-label={`Dictionary: ${word}`}
          style={{ left: dictAnchor.x, top: dictAnchor.y, zIndex: 60 }}
          onMouseUp={(e) => e.stopPropagation()}
        >
          <div className="word-lookup-header">
            <strong className="word-lookup-word">{word}</strong>
            <button type="button" className="word-lookup-close" aria-label="Close" onClick={closeAll}>×</button>
          </div>
          {loading ? <p className="muted word-lookup-status">Looking up…</p> : null}
          {dictError ? <p className="word-lookup-error" role="alert">{dictError}</p> : null}
          {!loading && !dictError && result ? (
            result.found ? (
              <div className="word-lookup-body">
                {result.lookedUp && result.lookedUp.toLowerCase() !== word.toLowerCase() ? (
                  <p className="muted word-lookup-base">base form: <em>{result.lookedUp}</em></p>
                ) : null}
                {result.phonetic || result.audio ? (
                  <p className="word-lookup-pron">
                    {result.phonetic ? <span className="word-lookup-phonetic">{result.phonetic}</span> : null}
                    {result.audio ? (
                      <button type="button" className="word-lookup-audio" aria-label="Play pronunciation"
                        onClick={() => playAudio(result.audio as string)}>🔊</button>
                    ) : null}
                  </p>
                ) : null}
                <ul className="word-lookup-meanings">
                  {result.meanings.map((meaning) => (
                    <li key={meaning.partOfSpeech} className="word-lookup-meaning">
                      <span className="word-lookup-pos">{meaning.partOfSpeech}</span>
                      <ol className="word-lookup-defs">
                        {meaning.definitions.map((def, i) => (
                          <li key={i}>{def.definition}
                            {def.example ? <span className="word-lookup-example muted"> &ldquo;{def.example}&rdquo;</span> : null}
                          </li>
                        ))}
                      </ol>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="muted word-lookup-status">No definition found for &ldquo;{word}&rdquo;.</p>
            )
          ) : null}
        </div>
      ) : null}

      {/* Selection toolbar */}
      {openSurface === "toolbar" && toolbarRect ? (
        <SelectionToolbar
          selectionRect={toolbarRect}
          color={toolbarColor}
          showDefine={toolbarShowDefine}
          onColorChange={setToolbarColor}
          onHighlight={() => void handleHighlight()}
          onAddNote={() => void handleAddNote()}
          onTranslate={handleTranslate}
          onDefine={handleDefine}
          onClose={closeAll}
          toolbarRef={toolbarRef}
        />
      ) : null}

      {/* Highlight edit popover */}
      {openSurface === "popover" && editHighlight && editMarkEl ? (
        <HighlightEditPopover
          highlight={editHighlight}
          anchorEl={editMarkEl}
          onClose={closeAll}
          onColorChange={handleEditColorChange}
          onNoteSave={handleEditNoteSave}
          onDelete={handleEditDelete}
          popoverRef={editPopoverRef}
        />
      ) : null}

      {/* Sentence translation popover (M13) */}
      {openSurface === "translate" && translateSelectionRect ? (
        <SentenceTranslatePopover
          selectionRect={translateSelectionRect}
          text={translateText}
          lang={translateLang}
          loading={translateLoading}
          result={translateResult}
          error={translateError}
          languages={languages}
          onLangChange={handleTranslateLangChange}
          onClose={closeAll}
          onRetry={handleTranslateRetry}
          popoverRef={translatePopoverRef}
        />
      ) : null}
    </>
  );
}
