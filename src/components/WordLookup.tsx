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

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import type { SupportedLanguage } from "@/lib/supported-languages";
import {
  useHighlights,
} from "./ReaderHighlightsProvider";
import { useReaderAudio } from "./ReaderAudioProvider";
import SelectionToolbar from "./SelectionToolbar";
import HighlightEditPopover from "./HighlightEditPopover";
import SentenceTranslatePopover from "./SentenceTranslatePopover";
import GrammarPopover from "./GrammarPopover";
import { TIER_LABELS, TIER_VARIANTS } from "@/lib/option-registries";
import { Badge } from "@/components/ui/Badge";
import {
  applyHighlightMarks,
  computeAnchor,
} from "@/components/reader/wordLookup/highlightMarks";
import { useDictionaryLookup } from "@/components/reader/wordLookup/useDictionaryLookup";
import { useGrammarExplanation } from "@/components/reader/wordLookup/useGrammarExplanation";
import { useSentenceTranslation } from "@/components/reader/wordLookup/useSentenceTranslation";
import { useTtsProseHighlight } from "@/components/reader/wordLookup/useTtsProseHighlight";
import {
  wordAtPoint,
  extractContextSentence,
} from "@/components/reader/wordLookup/selectionHelpers";
import { useSaveWord } from "@/components/reader/wordLookup/useSaveWord";
import { useHighlightActions } from "@/components/reader/wordLookup/useHighlightActions";
import { useSurfaceController } from "@/components/reader/wordLookup/useSurfaceController";
import { STORAGE_KEYS } from "@/lib/storage-keys";

const POPOVER_WIDTH = 340;
const POPOVER_HEIGHT = 400;
const MINI_PLAYER_HEIGHT = 56;

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
  const dictCloseRef = useRef<HTMLButtonElement>(null);
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
      // Store the raw anchor point; the layout effect below measures the real
      // rendered height and clamps/flips so the whole popover (incl. Save) stays
      // on-screen above the mini-player. A fixed POPOVER_HEIGHT estimate is unsafe
      // because the real max-height is 60vh, far taller than the old 400px guess.
      surface.openDictionary(clientX, clientY);
      setWord(candidate);
      saveWord.openForWord(candidate);
      void runLookup(candidate);
    },
    [surface, runLookup, setWord, saveWord],
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

  // Toggle save/unsave — delegated entirely to useSaveWord
  const handleToggleSave = saveWord.handleToggleSave;

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
        const stored = typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEYS.LAST_HL_COLOR) : null;
        const color = (stored && ["yellow", "green", "blue", "pink"].includes(stored))
          ? (stored as Parameters<typeof surface.openToolbar>[3])
          : undefined;
        surface.openToolbar(rect, isSingleWord, isShortPhrase, color);
        return;
      }

      const target = e.target as Element;
      const markEl = target.closest<HTMLElement>("mark.rw-hl");
      if (markEl?.dataset.hlId) {
        surface.closeAll();
        resetDictionary();
        saveWord.resetSaveError();
        resetTranslation();
        resetGrammar();
        surface.openEditPopover(markEl.dataset.hlId, markEl);
        return;
      }

      let candidate = wordAtPoint(e.clientX, e.clientY) ?? "";
      candidate = candidate.replace(/^[^A-Za-z'']+|[^A-Za-z'']+$/g, "");
      if (!candidate || !/[A-Za-z]/.test(candidate)) return;
      closeAll();
      openDictionary(candidate, e.clientX, e.clientY);
    },
    [surface, closeAll, openDictionary, resetDictionary, saveWord, resetTranslation, resetGrammar],
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
      surface.openToolbar(rect, isSingleWord, isShortPhrase);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [surface]);

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
    surface.transitionToTranslate();
    void runSentenceTranslate(text, translateLang);
  }, [toolbarRect, translateLang, runSentenceTranslate, setTranslateSelectionRect, setTranslateText, surface]);

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
  }, [toolbarRect, runGrammarExplain, setGrammarPhrase, setGrammarSelectionRect, surface]);

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
                const tier = result?.frequencyTier ?? null;
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
            {saveWord.saveError ? (
              <p className="word-lookup-error" role="alert" style={{ fontSize: "0.75rem", margin: 0 }}>{saveWord.saveError}</p>
            ) : null}
            <button
              type="button"
              className={`word-lookup-save-btn${saveWord.wordSaved ? " word-lookup-save-btn--saved" : ""}`}
              onClick={() => void handleToggleSave()}
              disabled={saveWord.savePending || loading}
              aria-pressed={saveWord.wordSaved}
              aria-label={saveWord.wordSaved ? `Remove "${word}" from study list` : `Save "${word}" to study list`}
            >
              {saveWord.savePending ? "…" : saveWord.wordSaved ? "✓ Saved" : "Save word"}
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
