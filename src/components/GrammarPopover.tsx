"use client";

/**
 * GrammarPopover (#114)
 *
 * Floating panel anchored to a text selection rect. Displays an AI-generated
 * grammar / phrase explanation. All content is rendered as plain text nodes
 * split on newlines — never dangerouslySetInnerHTML.
 *
 * Positioning mirrors SentenceTranslatePopover: clamp horizontally, flip
 * above/below the selection rect, dodge the mini-player band.
 */

import { useEffect, useRef } from "react";
import { BookMarked, RotateCcw, X } from "lucide-react";
import { Button, IconButton } from "@/components/ui";
import { usePopoverPosition } from "@/lib/use-popover-position";

export interface GrammarResult {
  explanation: string | null;
  fallback: boolean;
}

interface Props {
  selectionRect: DOMRect;
  phrase: string;
  loading: boolean;
  result: GrammarResult | null;
  error: string | null;
  onClose: () => void;
  onRetry: () => void;
  popoverRef: React.RefObject<HTMLDivElement | null>;
}

export default function GrammarPopover({
  selectionRect,
  phrase,
  loading,
  result,
  error,
  onClose,
  onRetry,
  popoverRef,
}: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);

  usePopoverPosition(popoverRef, selectionRect, {
    placement: "below",
    estimatedHeight: 200,
    estimatedWidth: 360,
    deps: [selectionRect, loading, result, error],
  });

  // Focus the close button when the popover first opens
  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  // Keyboard: Escape closes
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const lines = result?.explanation
    ? result.explanation.split(/\n+/).filter((l) => l.trim())
    : [];

  return (
    <div
      ref={popoverRef}
      role="dialog"
      aria-label={`Grammar: ${phrase}`}
      aria-modal="false"
      className="grammar-popover"
      style={{ left: 0, top: 0, position: "fixed", zIndex: 60 }}
      onMouseUp={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="grammar-popover-header">
        <div className="grammar-popover-title">
          <BookMarked size={14} aria-hidden="true" />
          <span className="grammar-popover-phrase">&ldquo;{phrase}&rdquo;</span>
        </div>
        <IconButton
          ref={closeRef}
          className="grammar-popover-close"
          aria-label="Close grammar explanation"
          onClick={onClose}
        >
          <X size={14} aria-hidden="true" />
        </IconButton>
      </div>

      {/* Body */}
      <div className="grammar-popover-body">
        {loading ? (
          <div aria-live="polite" aria-busy="true">
            <div className="grammar-shimmer" />
            <div className="grammar-shimmer grammar-shimmer--short" />
          </div>
        ) : error ? (
          <div className="grammar-error" role="alert">
            <p>{error}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="grammar-retry-btn"
              leadingIcon={<RotateCcw size={12} aria-hidden="true" />}
              onClick={onRetry}
            >
              Try again
            </Button>
          </div>
        ) : result?.fallback ? (
          <p className="grammar-fallback">
            Grammar explanation is not available right now.
          </p>
        ) : lines.length > 0 ? (
          <div className="grammar-explanation">
            {lines.map((line, i) => (
              <p key={i}>{line}</p>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
