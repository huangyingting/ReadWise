"use client";

/**
 * DictionaryPopover
 *
 * Floating dictionary panel extracted from the inline JSX in WordLookup.
 * Uses the shared Reader floating-surface lifecycle.
 * Focuses its close button on mount; focus return to the prose is handled by
 * WordLookup's openSurface effect.
 *
 * Layout: the surface itself is the scroll container (so the shared floating
 * position hook can preserve its scroll offset); the header and the save
 * footer are sticky so the word, close, and save stay reachable while long
 * entries scroll.
 */

import { useRef } from "react";
import type { RefObject } from "react";
import { Bookmark, BookmarkCheck, Volume2, X } from "lucide-react";
import type { DictionaryResult } from "@/lib/lexical/provider";
import { TIER_LABELS, TIER_VARIANTS } from "@/lib/option-registries";
import { Badge, Button, IconButton, SkeletonText } from "@/components/ui";
import { ReaderFloatingSurface } from "@/components/reader/ReaderFloatingSurface";

const POPOVER_GAP = 12;

interface SaveWordState {
  wordSaved: boolean;
  savePending: boolean;
  saveError: string | null;
  handleToggleSave: () => Promise<void>;
}

interface DictionaryPopoverProps {
  word: string;
  loading: boolean;
  result: DictionaryResult | null;
  dictError: string | null;
  anchor: { x: number; y: number };
  saveWord: SaveWordState;
  onClose: () => void;
  onPlay: (src: string) => void;
  popoverRef: RefObject<HTMLDivElement | null>;
}

function hasDifferentBaseForm(result: DictionaryResult, word: string): boolean {
  if (!result.lookedUp) return false;
  return result.lookedUp.toLowerCase() !== word.toLowerCase();
}

function getSaveButtonLabel(saveWord: SaveWordState): string {
  if (saveWord.savePending) return "Saving…";
  return saveWord.wordSaved ? "Saved to study list" : "Save word";
}

function DictionaryEntry({ result }: { result: DictionaryResult }) {
  return (
    <ol className="word-lookup-meanings">
      {result.meanings.map((meaning) => (
        <li key={meaning.partOfSpeech} className="word-lookup-meaning">
          <span className="word-lookup-pos">{meaning.partOfSpeech}</span>
          <ol className="word-lookup-defs">
            {meaning.definitions.map((def, i) => (
              <li key={i} className="word-lookup-def">
                <p className="word-lookup-def-text">{def.definition}</p>
                {def.example ? (
                  <p className="word-lookup-example">&ldquo;{def.example}&rdquo;</p>
                ) : null}
              </li>
            ))}
          </ol>
        </li>
      ))}
    </ol>
  );
}

export default function DictionaryPopover({
  word,
  loading,
  result,
  dictError,
  anchor,
  saveWord,
  onClose,
  onPlay,
  popoverRef,
}: DictionaryPopoverProps) {
  const closeRef = useRef<HTMLButtonElement>(null);

  const found = !loading && !dictError && result?.found ? result : null;
  const frequencyTier = result?.frequencyTier ?? null;
  const saveButtonAriaLabel = saveWord.wordSaved
    ? `Remove "${word}" from study list`
    : `Save "${word}" to study list`;

  return (
    <ReaderFloatingSurface
      ref={popoverRef}
      anchor={anchor}
      placement="below"
      label={`Dictionary: ${word}`}
      onClose={onClose}
      initialFocusRef={closeRef}
      className="word-lookup-popover"
      gap={POPOVER_GAP}
      busy={loading}
    >
      <header className="word-lookup-header">
        <div className="word-lookup-heading">
          <div className="word-lookup-title-row">
            <strong className="word-lookup-word">{word}</strong>
            {frequencyTier ? (
              <Badge
                variant={TIER_VARIANTS[frequencyTier]}
                aria-label={`Word frequency: ${TIER_LABELS[frequencyTier]}`}
              >
                {TIER_LABELS[frequencyTier]}
              </Badge>
            ) : null}
          </div>
          {found && (found.phonetic || found.audio || hasDifferentBaseForm(found, word)) ? (
            <div className="word-lookup-pron">
              {found.phonetic ? (
                <span className="word-lookup-phonetic">{found.phonetic}</span>
              ) : null}
              {found.audio ? (
                <IconButton
                  size="sm"
                  context="reading"
                  className="word-lookup-audio"
                  aria-label="Play pronunciation"
                  onClick={() => onPlay(found.audio as string)}
                >
                  <Volume2 size={16} aria-hidden />
                </IconButton>
              ) : null}
              {hasDifferentBaseForm(found, word) ? (
                <span className="word-lookup-base">
                  from <em>{found.lookedUp}</em>
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
        <IconButton
          ref={closeRef}
          context="reading"
          className="word-lookup-close"
          aria-label="Close"
          onClick={onClose}
        >
          <X size={18} aria-hidden />
        </IconButton>
      </header>

      {/* aria-live: announce status + the looked-up definition to screen readers */}
      <div className="word-lookup-content" aria-live="polite" aria-atomic="true">
        {loading ? (
          <div className="word-lookup-loading">
            <p className="sr-only" role="status">
              Looking up &ldquo;{word}&rdquo;&hellip;
            </p>
            <SkeletonText lines={4} aria-hidden />
          </div>
        ) : null}
        {dictError ? (
          <p className="word-lookup-error" role="alert">
            {dictError}
          </p>
        ) : null}
        {found ? <DictionaryEntry result={found} /> : null}
        {!loading && !dictError && result && !result.found ? (
          <p className="word-lookup-status">
            No definition found for &ldquo;{word}&rdquo;.
          </p>
        ) : null}
      </div>

      <footer className="word-lookup-footer">
        {saveWord.saveError ? (
          <p className="word-lookup-error" role="alert">
            {saveWord.saveError}
          </p>
        ) : null}
        <Button
          type="button"
          variant={saveWord.wordSaved ? "outline" : "primary"}
          size="sm"
          className="word-lookup-save-btn"
          leadingIcon={
            saveWord.wordSaved ? (
              <BookmarkCheck size={16} aria-hidden />
            ) : (
              <Bookmark size={16} aria-hidden />
            )
          }
          onClick={() => void saveWord.handleToggleSave()}
          disabled={saveWord.savePending || loading}
          aria-pressed={saveWord.wordSaved}
          aria-label={saveButtonAriaLabel}
        >
          {getSaveButtonLabel(saveWord)}
        </Button>
      </footer>
    </ReaderFloatingSurface>
  );
}
