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

import { useRef } from "react";
import { Languages, RotateCcw, X } from "lucide-react";
import { Button, IconButton, Select } from "@/components/ui";
import { ReaderFloatingSurface } from "@/components/reader/ReaderFloatingSurface";
import type { TranslateSentenceResult } from "@/components/reader/wordLookup/sentenceTranslationTypes";
import type { SupportedLanguage } from "@/lib/supported-languages";
import { languageLabel } from "@/lib/supported-languages";

const SHIMMER_LINE_WIDTHS = ["92%", "78%", "55%"] as const;

export type { TranslateSentenceResult } from "@/components/reader/wordLookup/sentenceTranslationTypes";

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

function translationParagraphs(result: TranslateSentenceResult | null): string[] {
  if (!result || result.fallback || !result.translation) {
    return [];
  }

  return result.translation
    .split(/\n{2,}/)
    .filter((paragraph) => paragraph.trim().length > 0);
}

function TranslationLoading() {
  return (
    <div className="rw-tr-shimmer" role="status" aria-label="Translating…">
      {SHIMMER_LINE_WIDTHS.map((width) => (
        <div key={width} className="rw-tr-shimmer-line" style={{ width }} />
      ))}
    </div>
  );
}

function RetryButton({ onRetry }: Pick<Props, "onRetry">) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="rw-tr-retry"
      leadingIcon={<RotateCcw size={12} aria-hidden="true" />}
      onClick={onRetry}
    >
      Retry
    </Button>
  );
}

function TranslationUnavailable({
  alert,
  children,
  onRetry,
}: Pick<Props, "onRetry"> & {
  alert?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="rw-tr-unavailable" role={alert ? "alert" : undefined}>
        {children}
      </p>
      <RetryButton onRetry={onRetry} />
    </div>
  );
}

function TranslationContent({
  loading,
  result,
  error,
  lang,
  onRetry,
}: Pick<Props, "loading" | "result" | "error" | "lang" | "onRetry">) {
  if (loading) {
    return <TranslationLoading />;
  }

  if (error) {
    return (
      <TranslationUnavailable alert onRetry={onRetry}>
        Couldn&rsquo;t translate that. Try again.
      </TranslationUnavailable>
    );
  }

  if (!result) {
    return null;
  }

  if (result.fallback) {
    return (
      <TranslationUnavailable onRetry={onRetry}>
        Translation isn&rsquo;t available right now. Try again in a moment.
      </TranslationUnavailable>
    );
  }

  const paragraphs = translationParagraphs(result);

  return (
    <>
      <div className="rw-tr-translation" lang={lang} dir="auto">
        {paragraphs.map((paragraph, i) => (
          <p key={i}>{paragraph}</p>
        ))}
      </div>
      <p className="rw-tr-meta">{languageLabel(lang)}</p>
    </>
  );
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

  return (
    <ReaderFloatingSurface
      ref={popoverRef}
      anchor={selectionRect}
      placement="below"
      label="Translation"
      onClose={onClose}
      initialFocusRef={closeRef}
      className="rw-tr-popover"
      gap={12}
      busy={loading}
    >
      {/* Header: title · language select · close */}
      <div className="rw-tr-header">
        <span className="rw-tr-title" aria-hidden="true">
          <Languages size={11} aria-hidden="true" />
          Translate
        </span>

        <Select
          className="rw-tr-lang-select"
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
        </Select>

        <IconButton
          ref={closeRef}
          className="rw-tr-close"
          aria-label="Close"
          onClick={onClose}
        >
          <X size={15} aria-hidden="true" />
        </IconButton>
      </div>

      {/* Body: source phrase + translation area */}
      <div className="rw-tr-body">
        {/* Source phrase — quoted, muted, line-clamped */}
        <p className="rw-tr-source" aria-label="Original text">
          &ldquo;{text}&rdquo;
        </p>

        {/* Translation result region — aria-live so screen readers announce the result */}
        <div aria-live="polite">
          <TranslationContent
            loading={loading}
            result={result}
            error={error}
            lang={lang}
            onRetry={onRetry}
          />
        </div>
      </div>
    </ReaderFloatingSurface>
  );
}
