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

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { SupportedLanguage } from "@/lib/supported-languages";
import {
  useHighlights,
  type Highlight as RwHighlight,
  type HighlightColor,
} from "./ReaderHighlightsProvider";
import { useReaderAudio } from "./ReaderAudioProvider";
import SelectionToolbar from "./SelectionToolbar";
import HighlightEditPopover from "./HighlightEditPopover";
import SentenceTranslatePopover from "./SentenceTranslatePopover";
import GrammarPopover from "./GrammarPopover";
import { frequencyTier, TIER_LABELS, TIER_VARIANTS } from "@/lib/frequency";
import { Badge } from "@/components/ui/Badge";
import {
  applyHighlightMarks,
  computeAnchor,
  overlapsAny,
} from "@/components/reader/wordLookup/highlightMarks";
import { useDictionaryLookup } from "@/components/reader/wordLookup/useDictionaryLookup";
import { useGrammarExplanation } from "@/components/reader/wordLookup/useGrammarExplanation";
import { useSentenceTranslation } from "@/components/reader/wordLookup/useSentenceTranslation";
import { useTtsProseHighlight } from "@/components/reader/wordLookup/useTtsProseHighlight";

const POPOVER_WIDTH = 340;
const POPOVER_HEIGHT = 400;
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

/**
 * Extracts the sentence containing `word` from the prose element's text content.
 * Splits on `.`, `?`, `!` followed by whitespace/end, and on paragraph breaks.
 * Returns the trimmed sentence or null when not found.
 */
function extractContextSentence(proseEl: HTMLElement, word: string): string | null {
  const text = proseEl.textContent ?? "";
  if (!text || !word) return null;
  // Split on sentence-ending punctuation (. ? !) followed by whitespace or EOL
  const sentences = text.split(/(?<=[.?!])\s+/);
  const lower = word.toLowerCase();
  for (const sentence of sentences) {
    if (sentence.toLowerCase().includes(lower)) {
      const trimmed = sentence.trim();
      if (trimmed.length > 0 && trimmed.length <= 400) return trimmed;
    }
  }
  return null;
}
// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type OpenSurface = "dictionary" | "toolbar" | "popover" | "translate" | "grammar" | null;

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
  const dictCloseRef = useRef<HTMLButtonElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const editPopoverRef = useRef<HTMLDivElement>(null);
  const translatePopoverRef = useRef<HTMLDivElement>(null);
  const grammarPopoverRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const [openSurface, setOpenSurface] = useState<OpenSurface>(null);

  // Dictionary
  const [dictAnchor, setDictAnchor] = useState<{ x: number; y: number } | null>(null);
  const { word, setWord, loading, result, dictError, resetDictionary, runLookup } = useDictionaryLookup();

  // Save word from popover (issue #107)
  const [wordSaved, setWordSaved] = useState(false);
  const [savePending, setSavePending] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Session-level cache: word -> saved state (avoids re-fetching on re-open)
  const savedCacheRef = useRef<Map<string, boolean>>(new Map());

  // Toolbar
  const [toolbarRect, setToolbarRect] = useState<DOMRect | null>(null);
  const [toolbarColor, setToolbarColor] = useState<HighlightColor>("yellow");
  const [toolbarShowDefine, setToolbarShowDefine] = useState(false);
  const [toolbarShowGrammar, setToolbarShowGrammar] = useState(false);
  const savedAnchorRef = useRef<SavedAnchor | null>(null);

  // Edit popover
  const [editHlId, setEditHlId] = useState<string | null>(null);
  const [editMarkEl, setEditMarkEl] = useState<HTMLElement | null>(null);

  const {
    translateLang,
    translateLoading,
    translateResult,
    translateError,
    translateText,
    translateSelectionRect,
    setTranslateText,
    setTranslateSelectionRect,
    seedTranslateLang,
    resetTranslation,
    runSentenceTranslate,
    changeTranslateLang,
    retryTranslation,
  } = useSentenceTranslation(articleId);

  const contextSentenceFor = useCallback(
    (phrase: string) => proseRef.current ? extractContextSentence(proseRef.current, phrase) ?? "" : "",
    [],
  );
  const {
    grammarLoading,
    grammarResult,
    grammarError,
    grammarPhrase,
    grammarSelectionRect,
    setGrammarPhrase,
    setGrammarSelectionRect,
    resetGrammar,
    runGrammarExplain,
    retryGrammar,
  } = useGrammarExplanation(articleId, contextSentenceFor);

  const { highlights, loading: hlLoading, add, updateColor, updateNote, remove, markOrphaned } = useHighlights();
  const editHighlight = editHlId ? (highlights.find((h) => h.id === editHlId) ?? null) : null;

  // TTS prose highlighting
  const readerAudio = useReaderAudio();
  useTtsProseHighlight(proseRef, readerAudio, highlights);

  const closeAll = useCallback(() => {
    setOpenSurface(null);
    setDictAnchor(null);
    setToolbarRect(null);
    setEditHlId(null);
    setEditMarkEl(null);
    savedAnchorRef.current = null;
    resetDictionary();
    setSaveError(null);
    setSavePending(false);
    resetTranslation();
    resetGrammar();
  }, [resetDictionary, resetGrammar, resetTranslation]);

  // Mark rendering
  useEffect(() => {
    if (!proseRef.current) return;
    applyHighlightMarks(proseRef.current, highlights, markOrphaned);
  }, [highlights, markOrphaned]);

  // Seed translate language from localStorage after mount
  useEffect(() => {
    seedTranslateLang();
  }, [seedTranslateLang]);

  const openDictionary = useCallback(
    (candidate: string, clientX: number, clientY: number) => {
      // Store the raw anchor point; the layout effect below measures the real
      // rendered height and clamps/flips so the whole popover (incl. Save) stays
      // on-screen above the mini-player. A fixed POPOVER_HEIGHT estimate is unsafe
      // because the real max-height is 60vh, far taller than the old 400px guess.
      setDictAnchor({ x: clientX, y: clientY });
      setWord(candidate);
      setOpenSurface("dictionary");
      setSaveError(null);
      // Restore saved state from session cache immediately
      const cached = savedCacheRef.current.get(candidate.toLowerCase());
      setWordSaved(cached ?? false);
      void runLookup(candidate);
    },
    [runLookup, setWord],
  );

  // Clamp/flip the dictionary popover using its REAL measured height so the whole
  // surface (incl. the Save footer) stays within the viewport, above the mini-player.
  useLayoutEffect(() => {
    if (openSurface !== "dictionary" || !dictAnchor) return;
    const el = popoverRef.current;
    if (!el) return;

    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Cap the height to the safe band (above the mini-player) so a tall entry
    // scrolls INSIDE the popover instead of running off-screen.
    const available = vh - MINI_PLAYER_HEIGHT - 24;
    el.style.maxHeight = `${available}px`;

    const pw = el.offsetWidth || POPOVER_WIDTH;
    const ph = el.offsetHeight || POPOVER_HEIGHT;

    // #3 — center the popover horizontally on the clicked word (anchor.x is the
    // click point) instead of anchoring its left edge there, so it pops over the
    // word rather than spilling into the right-hand gutter. Clamp to the viewport.
    const left = Math.max(12, Math.min(dictAnchor.x - pw / 2, vw - pw - 12));

    const safeBottom = vh - MINI_PLAYER_HEIGHT - 12;
    // Prefer below the anchor; flip above if it would overflow the safe band.
    let top = dictAnchor.y + 12;
    if (top + ph > safeBottom) top = dictAnchor.y - ph - 12;
    // Final clamp: keep the whole popover within the safe band.
    top = Math.min(top, safeBottom - ph);
    top = Math.max(12, top);

    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }, [openSurface, dictAnchor, loading, result, dictError, word]);

  // A11y parity with sibling popovers: move focus to the close button on open,
  // return focus to the reader prose (selection origin) on close.
  useEffect(() => {
    if (openSurface !== "dictionary") return;
    const prose = proseRef.current;
    dictCloseRef.current?.focus();
    return () => {
      prose?.focus();
    };
  }, [openSurface]);

  // Toggle save/unsave a word from the dictionary popover
  const handleToggleSave = useCallback(async () => {
    if (savePending) return;
    setSavePending(true);
    setSaveError(null);

    const isSaved = wordSaved;
    // Optimistic update
    setWordSaved(!isSaved);
    savedCacheRef.current.set(word.toLowerCase(), !isSaved);

    try {
      const endpoint = isSaved ? "/api/vocabulary/unsave" : "/api/vocabulary/save";
      const body: Record<string, unknown> = { word };

      if (!isSaved) {
        // Build explanation/example from dictionary result
        const firstMeaning = result?.found ? result.meanings[0] : null;
        const firstDef = firstMeaning?.definitions[0];
        if (firstDef?.definition) {
          body.explanation = `(${firstMeaning!.partOfSpeech}) ${firstDef.definition}`;
        }
        if (firstDef?.example) {
          body.example = firstDef.example;
        }
        // Context sentence from prose
        const prose = proseRef.current;
        if (prose) {
          const ctx = extractContextSentence(prose, word);
          if (ctx) body.contextSentence = ctx;
        }
        body.articleId = articleId;
      }

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(d?.error ?? "Could not update study list");
      }
    } catch (err) {
      // Revert on error
      setWordSaved(isSaved);
      savedCacheRef.current.set(word.toLowerCase(), isSaved);
      setSaveError(err instanceof Error ? err.message : "Could not update study list");
    } finally {
      setSavePending(false);
    }
  }, [savePending, wordSaved, word, result, articleId]);

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
        const wordCount = anchor.quote.trim().split(/\s+/).length;
        const isSingleWord = /^\s*[A-Za-z''-]+\s*$/.test(anchor.quote);
        const isShortPhrase = wordCount >= 2 && wordCount <= 5;
        savedAnchorRef.current = { ...anchor, selectionWord: anchor.quote.trim().split(/\s+/)[0] ?? "" };
        const stored = typeof window !== "undefined" ? localStorage.getItem("readwise:last-hl-color") : null;
        if (stored && ["yellow", "green", "blue", "pink"].includes(stored)) setToolbarColor(stored as HighlightColor);
        setToolbarRect(rect);
        setToolbarShowDefine(isSingleWord);
        setToolbarShowGrammar(isShortPhrase);
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
      const wordCount = anchor.quote.trim().split(/\s+/).length;
      const isSingleWord = /^\s*[A-Za-z''-]+\s*$/.test(anchor.quote);
      const isShortPhrase = wordCount >= 2 && wordCount <= 5;
      savedAnchorRef.current = { ...anchor, selectionWord: anchor.quote.trim().split(/\s+/)[0] ?? "" };
      setToolbarRect(rect);
      setToolbarShowDefine(isSingleWord);
      setToolbarShowGrammar(isShortPhrase);
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
        grammarPopoverRef.current?.contains(t) ||
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
  }, [toolbarRect, translateLang, runSentenceTranslate, setTranslateSelectionRect, setTranslateText]);

  const handleGrammar = useCallback(() => {
    const saved = savedAnchorRef.current;
    const rect = toolbarRect;
    if (!saved || !rect) return;
    const phrase = saved.quote.trim();
    if (!phrase) return;
    setGrammarPhrase(phrase);
    setGrammarSelectionRect(rect);
    setOpenSurface("grammar");
    setToolbarRect(null);
    void runGrammarExplain(phrase);
  }, [toolbarRect, runGrammarExplain, setGrammarPhrase, setGrammarSelectionRect]);

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
      {/* Subtle loading affordance while highlights are fetched — prevents the
          marks from visibly popping in with no context for the user. */}
      {hlLoading && (
        <p
          aria-live="polite"
          aria-atomic="true"
          className="sr-only"
        >
          Loading highlights…
        </p>
      )}
      <div
        ref={proseRef}
        className={`prose word-lookup-prose${hlLoading ? " rw-hl-loading" : ""}`}
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
          aria-modal="false"
          aria-label={`Dictionary: ${word}`}
          style={{ left: dictAnchor.x, top: dictAnchor.y, zIndex: 60 }}
          onMouseUp={(e) => e.stopPropagation()}
        >
          <div className="word-lookup-header">
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", flexWrap: "wrap" }}>
              <strong className="word-lookup-word">{word}</strong>
              {(() => {
                const tier = frequencyTier(word);
                if (!tier) return null;
                return (
                  <Badge
                    variant={TIER_VARIANTS[tier]}
                    aria-label={`Word frequency: ${TIER_LABELS[tier]}`}
                    style={{ fontSize: "0.7rem", padding: "1px 6px" }}
                  >
                    {TIER_LABELS[tier]}
                  </Badge>
                );
              })()}
            </div>
            <button
              ref={dictCloseRef}
              type="button"
              className="word-lookup-close"
              aria-label="Close"
              onClick={closeAll}
              onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); closeAll(); proseRef.current?.focus(); } }}
            >×</button>
          </div>
          {/* aria-live: announce status + the looked-up definition to screen readers */}
          <div aria-live="polite" aria-atomic="true">
            {loading ? <p className="muted word-lookup-status" role="status">Looking up “{word}”…</p> : null}
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
          {/* Save word footer */}
          <div className="word-lookup-footer">
            {saveError ? (
              <p className="word-lookup-error" role="alert" style={{ fontSize: "0.75rem", margin: 0 }}>{saveError}</p>
            ) : null}
            <button
              type="button"
              className={`word-lookup-save-btn${wordSaved ? " word-lookup-save-btn--saved" : ""}`}
              onClick={() => void handleToggleSave()}
              disabled={savePending || loading}
              aria-pressed={wordSaved}
              aria-label={wordSaved ? `Remove "${word}" from study list` : `Save "${word}" to study list`}
            >
              {savePending ? "…" : wordSaved ? "✓ Saved" : "Save word"}
            </button>
          </div>
        </div>
      ) : null}

      {/* Selection toolbar */}
      {openSurface === "toolbar" && toolbarRect ? (
        <SelectionToolbar
          selectionRect={toolbarRect}
          color={toolbarColor}
          showDefine={toolbarShowDefine}
          showGrammar={toolbarShowGrammar}
          onColorChange={setToolbarColor}
          onHighlight={() => void handleHighlight()}
          onAddNote={() => void handleAddNote()}
          onTranslate={handleTranslate}
          onDefine={handleDefine}
          onGrammar={handleGrammar}
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
          onLangChange={changeTranslateLang}
          onClose={closeAll}
          onRetry={retryTranslation}
          popoverRef={translatePopoverRef}
        />
      ) : null}

      {/* Grammar explanation popover (#114) */}
      {openSurface === "grammar" && grammarSelectionRect ? (
        <GrammarPopover
          selectionRect={grammarSelectionRect}
          phrase={grammarPhrase}
          loading={grammarLoading}
          result={grammarResult}
          error={grammarError}
          onClose={closeAll}
          onRetry={retryGrammar}
          popoverRef={grammarPopoverRef}
        />
      ) : null}
    </>
  );
}
