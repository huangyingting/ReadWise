"use client";

/**
 * SentenceTranslatePopover (M13)
 *
 * Inline translation popover anchored to a text selection rect.
 * Opens when the user clicks Translate in the M11 SelectionToolbar.
 *
 * States: loading (shimmer), result, graceful-unavailable (fallback:true),
 * network/HTTP error. All text is rendered as React text nodes — never
 * dangerouslySetInnerHTML.
 *
 * Positioning mirrors the dictionary popover: clamp horizontally, flip
 * above/below the selection rect, dodge the mini-player band.
 */

import { useEffect, useLayoutEffect, useRef } from "react";
import { Languages, RotateCcw, X } from "lucide-react";
import { cn, focusRing } from "@/lib/cn";
import type { SupportedLanguage } from "@/lib/supported-languages";
import { languageLabel } from "@/lib/supported-languages";

const MINI_PLAYER_HEIGHT = 56;

export interface TranslateSentenceResult {
  translation: string | null;
  fallback: boolean;
}

interface Props {
  /** The selection bounding rect used as the anchor point. */
  selectionRect: DOMRect;
  /** The original selected text. */
  text: string;
  /** Current target language code. */
  lang: string;
  /** True while a fetch is in flight. */
  loading: boolean;
  /** Resolved translation (null until loaded). */
  result: TranslateSentenceResult | null;
  /** Non-null when a network/HTTP error occurred. */
  error: string | null;
  /** All supported languages for the in-popover select. */
  languages: SupportedLanguage[];
  /** Called when user changes the language select. */
  onLangChange: (lang: string) => void;
  onClose: () => void;
  onRetry: () => void;
  /** Ref guard: outside-click should ignore this element. */
  popoverRef: React.RefObject<HTMLDivElement | null>;
}

export default function SentenceTranslatePopover({
  selectionRect,
  text,
  lang,
  loading,
  result,
  error,
  languages,
  onLangChange,
  onClose,
  onRetry,
  popoverRef,
}: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);

  // Clamp/flip position — re-run after content changes height.
  useLayoutEffect(() => {
    const el = popoverRef.current;
    if (!el) return;

    const pw = el.offsetWidth || 360;
    const ph = el.offsetHeight || 200;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Anchor to the bottom-left of the selection rect.
    const anchorX = selectionRect.left;
    const anchorY = selectionRect.bottom;

    const left = Math.max(12, Math.min(anchorX, vw - pw - 12));
    const safeBottom = vh - MINI_PLAYER_HEIGHT - ph - 12;
    let top = anchorY > safeBottom ? anchorY - ph - 12 : anchorY + 12;
    top = Math.max(12, top);

    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }, [selectionRect, loading, result, error, popoverRef]);

  // Move focus to the close button on open (light management — not a trap).
  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  const paragraphs =
    result && !result.fallback && result.translation
      ? result.translation.split(/\n{2,}/).filter((p) => p.trim().length > 0)
      : [];

  return (
    <div
      ref={popoverRef}
      role="dialog"
      aria-label="Translation"
      aria-busy={loading}
      className="rw-tr-popover"
      style={{ left: 0, top: 0 }} // overridden by useLayoutEffect
      onMouseUp={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* Header: title · language select · close */}
      <div className="rw-tr-header">
        <span className="rw-tr-title" aria-hidden="true">
          <Languages size={11} aria-hidden="true" />
          Translate
        </span>

        <select
          className={cn("rw-tr-lang-select", focusRing)}
          aria-label="Translation language"
          value={lang}
          disabled={loading}
          onChange={(e) => onLangChange(e.target.value)}
        >
          {languages.map((l) => (
            <option key={l.code} value={l.code}>
              {l.label}
            </option>
          ))}
        </select>

        <button
          ref={closeRef}
          type="button"
          className={cn("rw-tr-close", focusRing)}
          aria-label="Close"
          onClick={onClose}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              onClose();
            }
          }}
        >
          <X size={15} aria-hidden="true" />
        </button>
      </div>

      {/* Body: source phrase + translation area */}
      <div className="rw-tr-body">
        {/* Source phrase — quoted, muted, line-clamped */}
        <p className="rw-tr-source" aria-label="Original text">
          &ldquo;{text}&rdquo;
        </p>

        {/* Translation result region — aria-live so screen readers announce the result */}
        <div aria-live="polite">
          {loading ? (
            <div className="rw-tr-shimmer" role="status" aria-label="Translating…">
              <div className="rw-tr-shimmer-line" style={{ width: "92%" }} />
              <div className="rw-tr-shimmer-line" style={{ width: "78%" }} />
              <div className="rw-tr-shimmer-line" style={{ width: "55%" }} />
            </div>
          ) : error ? (
            <div>
              <p className="rw-tr-unavailable" role="alert">
                Couldn&rsquo;t translate that. Try again.
              </p>
              <button
                type="button"
                className={cn("rw-tr-retry", focusRing)}
                onClick={onRetry}
              >
                <RotateCcw size={12} aria-hidden="true" />
                Retry
              </button>
            </div>
          ) : result ? (
            result.fallback ? (
              <div>
                <p className="rw-tr-unavailable">
                  Translation isn&rsquo;t available right now. Try again in a moment.
                </p>
                <button
                  type="button"
                  className={cn("rw-tr-retry", focusRing)}
                  onClick={onRetry}
                >
                  <RotateCcw size={12} aria-hidden="true" />
                  Retry
                </button>
              </div>
            ) : (
              <>
                <div className="rw-tr-translation" lang={lang} dir="auto">
                  {paragraphs.map((p, i) => (
                    <p key={i}>{p}</p>
                  ))}
                </div>
                <p className="rw-tr-meta">{languageLabel(lang)}</p>
              </>
            )
          ) : null}
        </div>
      </div>
    </div>
  );
}
