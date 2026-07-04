"use client";

/**
 * DictionaryPopover
 *
 * Floating dictionary panel extracted from the inline JSX in WordLookup.
 * Positioned by usePopoverPosition (point anchor, prefer-below / flip-above).
 * Focuses its close button on mount; focus return to the prose is handled by
 * WordLookup's openSurface effect.
 */

import { useRef } from "react";
import type { RefObject } from "react";
import type { DictionaryResult } from "@/lib/lexical/provider";
import { TIER_LABELS, TIER_VARIANTS } from "@/lib/option-registries";
import { Badge, Button, IconButton, Inline } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useFocusTrap } from "@/lib/focus-trap";
import { usePopoverPosition } from "@/lib/use-popover-position";

const POPOVER_WIDTH = 340;
const POPOVER_HEIGHT = 400;
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
  if (saveWord.savePending) return "…";
  return saveWord.wordSaved ? "✓ Saved" : "Save word";
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

  usePopoverPosition(popoverRef, anchor, {
    placement: "below",
    estimatedHeight: POPOVER_HEIGHT,
    estimatedWidth: POPOVER_WIDTH,
    gap: POPOVER_GAP,
    setMaxHeight: true,
    deps: [anchor, loading, result, dictError, word],
  });

  useFocusTrap(popoverRef, true, onClose, {
    initialFocusRef: closeRef,
    stopEscapePropagation: true,
  });

  const frequencyTier = result?.frequencyTier ?? null;
  const saveButtonAriaLabel = saveWord.wordSaved
    ? `Remove "${word}" from study list`
    : `Save "${word}" to study list`;

  return (
    <div
      ref={popoverRef}
      className="word-lookup-popover"
      role="dialog"
      aria-modal="false"
      aria-label={`Dictionary: ${word}`}
      style={{ left: anchor.x, top: anchor.y, zIndex: 60 }}
      onMouseUp={(e) => e.stopPropagation()}
    >
      <div className="word-lookup-header">
        <Inline gap="2">
          <strong className="word-lookup-word">{word}</strong>
          {frequencyTier ? (
            <Badge
              variant={TIER_VARIANTS[frequencyTier]}
              aria-label={`Word frequency: ${TIER_LABELS[frequencyTier]}`}
            >
              {TIER_LABELS[frequencyTier]}
            </Badge>
          ) : null}
        </Inline>
        <IconButton
          ref={closeRef}
          className="word-lookup-close"
          aria-label="Close"
          onClick={onClose}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              onClose();
            }
          }}
        >
          ×
        </IconButton>
      </div>

      {/* aria-live: announce status + the looked-up definition to screen readers */}
      <div aria-live="polite" aria-atomic="true">
        {loading ? (
          <p className="muted word-lookup-status" role="status">
            Looking up &ldquo;{word}&rdquo;&hellip;
          </p>
        ) : null}
        {dictError ? (
          <p className="word-lookup-error" role="alert">
            {dictError}
          </p>
        ) : null}
        {!loading && !dictError && result ? (
          result.found ? (
            <div className="word-lookup-body">
              {hasDifferentBaseForm(result, word) ? (
                <p className="muted word-lookup-base">
                  base form: <em>{result.lookedUp}</em>
                </p>
              ) : null}
              {result.phonetic || result.audio ? (
                <p className="word-lookup-pron">
                  {result.phonetic ? (
                    <span className="word-lookup-phonetic">{result.phonetic}</span>
                  ) : null}
                  {result.audio ? (
                    <IconButton
                      size="sm"
                      className="word-lookup-audio"
                      aria-label="Play pronunciation"
                      onClick={() => onPlay(result.audio as string)}
                    >
                      🔊
                    </IconButton>
                  ) : null}
                </p>
              ) : null}
              <ul className="word-lookup-meanings">
                {result.meanings.map((meaning) => (
                  <li key={meaning.partOfSpeech} className="word-lookup-meaning">
                    <span className="word-lookup-pos">{meaning.partOfSpeech}</span>
                    <ol className="word-lookup-defs">
                      {meaning.definitions.map((def, i) => (
                        <li key={i}>
                          {def.definition}
                          {def.example ? (
                            <span className="word-lookup-example muted">
                              {" "}
                              &ldquo;{def.example}&rdquo;
                            </span>
                          ) : null}
                        </li>
                      ))}
                    </ol>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="muted word-lookup-status">
              No definition found for &ldquo;{word}&rdquo;.
            </p>
          )
        ) : null}
      </div>

      {/* Save word footer */}
      <div className="word-lookup-footer">
        {saveWord.saveError ? (
          <p
            className="word-lookup-error"
            role="alert"
          >
            {saveWord.saveError}
          </p>
        ) : null}
        <Button
          type="button"
          variant={saveWord.wordSaved ? "outline" : "primary"}
          size="sm"
          className={cn(
            "word-lookup-save-btn",
            saveWord.wordSaved && "word-lookup-save-btn--saved",
          )}
          onClick={() => void saveWord.handleToggleSave()}
          disabled={saveWord.savePending || loading}
          aria-pressed={saveWord.wordSaved}
          aria-label={saveButtonAriaLabel}
        >
          {getSaveButtonLabel(saveWord)}
        </Button>
      </div>
    </div>
  );
}
