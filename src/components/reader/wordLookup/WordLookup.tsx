"use client";

/**
 * WordLookup — thin orchestrator for the reader interaction subsystems.
 *
 * ONE floating surface is open at a time, chosen by gesture:
 *
 *   Gesture                   | Surface
 *   ─────────────────────────────────────────────────────────
 *   Click/tap a word           | Dictionary popover
 *   Click a <mark.rw-hl>       | Highlight edit popover
 *   Drag-select text           | Selection toolbar
 *   Cmd/Ctrl+E w/ selection    | Selection toolbar (keyboard a11y)
 *
 * Subsystems:
 *   selectionHelpers   — pure DOM helpers (wordAtPoint, extractContextSentence)
 *   useSurfaceController — surface state reducer (single-surface invariant)
 *   useSaveWord        — save/unsave vocabulary with session-level cache
 *   useHighlightActions — highlight + add-note with overlap merge
 *   useDictionaryLookup, useSentenceTranslation, useGrammarExplanation,
 *   useTtsProseHighlight, highlightMarks — prior extracted subsystems
 *
 * The mark renderer (useEffect) walks text nodes via TreeWalker to wrap
 * matching ranges in <mark class="rw-hl">. It NEVER re-sanitizes or
 * sets innerHTML — it operates on the existing, already-sanitized nodes.
 */

import { useCallback, useEffect, useMemo, useRef } from "react";
import type { SupportedLanguage } from "@/lib/supported-languages";
import {
  useHighlights,
  type HighlightColor,
} from "@/components/ReaderHighlightsProvider";
import { useReaderAudio } from "@/components/ReaderAudioProvider";
import SelectionToolbar from "./SelectionToolbar";
import HighlightEditPopover from "./HighlightEditPopover";
import SentenceTranslatePopover from "@/components/SentenceTranslatePopover";
import GrammarPopover from "@/components/GrammarPopover";
import DictionaryPopover from "./DictionaryPopover";
import {
  applyHighlightMarks,
  computeAnchor,
} from "./highlightMarks";
import { useDictionaryLookup } from "./useDictionaryLookup";
import { useGrammarExplanation } from "./useGrammarExplanation";
import { useSentenceTranslation } from "./useSentenceTranslation";
import { useTtsProseHighlight } from "./useTtsProseHighlight";
import {
  wordAtPoint,
  extractContextSentence,
} from "./selectionHelpers";
import { useSaveWord } from "./useSaveWord";
import { useHighlightActions } from "./useHighlightActions";
import { useSurfaceController } from "./useSurfaceController";
import { STORAGE_KEYS } from "@/lib/storage-keys";

const LOOKUP_BOUNDARY_RE = /^[^A-Za-z'']+|[^A-Za-z'']+$/g;
const LOOKUP_HAS_LETTER_RE = /[A-Za-z]/;
const SINGLE_WORD_SELECTION_RE = /^\s*[A-Za-z''-]+\s*$/;
const HIGHLIGHT_COLORS: readonly HighlightColor[] = ["yellow", "green", "blue", "pink"];

function normalizeLookupCandidate(candidate: string): string {
  const trimmed = candidate.replace(LOOKUP_BOUNDARY_RE, "");
  return LOOKUP_HAS_LETTER_RE.test(trimmed) ? trimmed : "";
}

function getSelectionToolbarDetails(quote: string) {
  const words = quote.trim().split(/\s+/);
  const wordCount = words.length;
  return {
    isSingleWord: SINGLE_WORD_SELECTION_RE.test(quote),
    isShortPhrase: wordCount >= 2 && wordCount <= 5,
    selectionWord: words[0] ?? "",
  };
}

function isHighlightColor(value: string | null): value is HighlightColor {
  return HIGHLIGHT_COLORS.includes(value as HighlightColor);
}

function getStoredToolbarColor(): HighlightColor | undefined {
  if (typeof window === "undefined") return undefined;
  const stored = localStorage.getItem(STORAGE_KEYS.LAST_HL_COLOR);
  return isHighlightColor(stored) ? stored : undefined;
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
  // DOM refs
  const proseRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const editPopoverRef = useRef<HTMLDivElement>(null);
  const translatePopoverRef = useRef<HTMLDivElement>(null);
  const grammarPopoverRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Surface state controller (single-surface-open invariant, selection anchor)
  const surface = useSurfaceController();
  const {
    openSurface,
    dictAnchor,
    toolbarRect,
    toolbarColor,
    toolbarShowDefine,
    toolbarShowGrammar,
    editHlId,
    editMarkEl,
    savedAnchorRef,
  } = surface;

  // Dictionary lookup
  const { word, setWord, loading, result, dictError, resetDictionary, runLookup } =
    useDictionaryLookup();

  // Save / unsave vocabulary
  const saveWord = useSaveWord(word, result, articleId, proseRef);

  // Sentence translation
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

  // Grammar explanation
  const contextSentenceFor = useCallback(
    (phrase: string) =>
      proseRef.current ? extractContextSentence(proseRef.current, phrase) ?? "" : "",
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

  // Highlights
  const { highlights, loading: hlLoading, add, updateColor, updateNote, remove, markOrphaned } =
    useHighlights();
  const editHighlight = editHlId
    ? (highlights.find((h) => h.id === editHlId) ?? null)
    : null;

  // TTS prose highlighting
  const readerAudio = useReaderAudio();
  useTtsProseHighlight(proseRef, readerAudio, highlights);

  // Highlight toolbar actions (overlap merge logic)
  const { handleHighlight, handleAddNote } = useHighlightActions(
    highlights,
    add,
    remove,
    proseRef,
  );

  // Global close: resets surface controller + all subsystem states
  const closeAll = useCallback(() => {
    surface.closeAll();
    resetDictionary();
    saveWord.resetSaveError();
    resetTranslation();
    resetGrammar();
  }, [surface, resetDictionary, saveWord, resetTranslation, resetGrammar]);

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
      surface.openDictionary(clientX, clientY);
      setWord(candidate);
      saveWord.openForWord(candidate);
      void runLookup(candidate);
    },
    [surface, runLookup, setWord, saveWord],
  );

  // Clamp/flip the dictionary popover — now handled by DictionaryPopover via usePopoverPosition.
  // Return focus to the reader prose (selection origin) when the dictionary closes.
  useEffect(() => {
    if (openSurface !== "dictionary") return;
    const prose = proseRef.current;
    return () => { prose?.focus(); };
  }, [openSurface]);

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
        const { isSingleWord, isShortPhrase, selectionWord } =
          getSelectionToolbarDetails(anchor.quote);
        savedAnchorRef.current = { ...anchor, selectionWord };
        surface.openToolbar(rect, isSingleWord, isShortPhrase, getStoredToolbarColor());
        return;
      }

      const target = e.target as Element;
      const markEl = target.closest<HTMLElement>("mark.rw-hl");
      if (markEl?.dataset.hlId) {
        closeAll();
        surface.openEditPopover(markEl.dataset.hlId, markEl);
        return;
      }

      const candidate = normalizeLookupCandidate(wordAtPoint(e.clientX, e.clientY) ?? "");
      if (!candidate) return;
      closeAll();
      openDictionary(candidate, e.clientX, e.clientY);
    },
    [surface, savedAnchorRef, closeAll, openDictionary],
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
      const { isSingleWord, isShortPhrase, selectionWord } =
        getSelectionToolbarDetails(anchor.quote);
      savedAnchorRef.current = { ...anchor, selectionWord };
      surface.openToolbar(rect, isSingleWord, isShortPhrase);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [surface, savedAnchorRef]);

  // selectionchange → dismiss toolbar when selection collapses
  useEffect(() => {
    if (openSurface !== "toolbar") return;
    let timer: ReturnType<typeof setTimeout>;
    const onSelChange = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const s = window.getSelection();
        if (!s || s.isCollapsed) surface.dismissToolbar();
      }, 120);
    };
    document.addEventListener("selectionchange", onSelChange);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("selectionchange", onSelChange);
    };
  }, [openSurface, surface]);

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

  // Toolbar: create highlight — delegates overlap merge to useHighlightActions
  const handleHighlightAction = useCallback(async () => {
    const saved = savedAnchorRef.current;
    if (!saved) return;
    localStorage.setItem(STORAGE_KEYS.LAST_HL_COLOR, toolbarColor);
    window.getSelection()?.removeAllRanges();
    await handleHighlight(saved, toolbarColor);
    closeAll();
  }, [savedAnchorRef, toolbarColor, handleHighlight, closeAll]);

  // Toolbar: add note — delegates overlap merge to useHighlightActions
  const handleAddNoteAction = useCallback(async () => {
    const saved = savedAnchorRef.current;
    if (!saved) return;
    localStorage.setItem(STORAGE_KEYS.LAST_HL_COLOR, toolbarColor);
    window.getSelection()?.removeAllRanges();
    surface.closeAll();
    await handleAddNote(saved, toolbarColor, (hlId, markEl) => {
      surface.openEditPopover(hlId, markEl);
    });
  }, [savedAnchorRef, toolbarColor, handleAddNote, surface]);

  // Toolbar: define
  const handleDefine = useCallback(() => {
    const saved = savedAnchorRef.current;
    if (!saved) return;
    const candidate = normalizeLookupCandidate(saved.selectionWord).trim();
    if (!candidate) return;
    closeAll();
    window.getSelection()?.removeAllRanges();
    openDictionary(candidate, window.innerWidth / 2, window.innerHeight / 2);
  }, [savedAnchorRef, closeAll, openDictionary]);

  const handleTranslate = useCallback(() => {
    const saved = savedAnchorRef.current;
    const rect = toolbarRect;
    if (!saved || !rect) return;
    const text = saved.quote;
    if (!text.trim()) return;
    // Transition from toolbar → translate surface (does NOT call closeAll, preserving state)
    setTranslateText(text);
    setTranslateSelectionRect(rect);
    surface.transitionToTranslate();
    void runSentenceTranslate(text, translateLang);
  }, [savedAnchorRef, toolbarRect, translateLang, runSentenceTranslate, setTranslateSelectionRect, setTranslateText, surface]);

  const handleGrammar = useCallback(() => {
    const saved = savedAnchorRef.current;
    const rect = toolbarRect;
    if (!saved || !rect) return;
    const phrase = saved.quote.trim();
    if (!phrase) return;
    setGrammarPhrase(phrase);
    setGrammarSelectionRect(rect);
    surface.transitionToGrammar();
    void runGrammarExplain(phrase);
  }, [savedAnchorRef, toolbarRect, runGrammarExplain, setGrammarPhrase, setGrammarSelectionRect, surface]);

  // Edit popover handlers
  const handleEditColorChange = useCallback((color: Parameters<typeof updateColor>[1]) => {
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
        <DictionaryPopover
          word={word}
          loading={loading}
          result={result}
          dictError={dictError}
          anchor={dictAnchor}
          saveWord={saveWord}
          onClose={closeAll}
          onPlay={playAudio}
          popoverRef={popoverRef}
        />
      ) : null}

      {/* Selection toolbar */}
      {openSurface === "toolbar" && toolbarRect ? (
        <SelectionToolbar
          selectionRect={toolbarRect}
          color={toolbarColor}
          showDefine={toolbarShowDefine}
          showGrammar={toolbarShowGrammar}
          onColorChange={surface.setToolbarColor}
          onHighlight={() => void handleHighlightAction()}
          onAddNote={() => void handleAddNoteAction()}
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
