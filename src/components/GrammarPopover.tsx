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

import { useRef, type RefObject } from "react";
import { BookMarked, RotateCcw, X } from "lucide-react";
import { Button, IconButton } from "@/components/ui";
import { useFocusTrap } from "@/lib/focus-trap";
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
  popoverRef: RefObject<HTMLDivElement | null>;
}

const POSITION_OPTIONS = {
  placement: "below" as const,
  estimatedHeight: 200,
  estimatedWidth: 360,
};

function getExplanationLines(explanation?: string | null): string[] {
  return explanation ? explanation.split(/\n+/).filter((line) => line.trim()) : [];
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
    ...POSITION_OPTIONS,
    deps: [selectionRect, loading, result, error],
  });

  useFocusTrap(popoverRef, true, onClose, {
    initialFocusRef: closeRef,
    stopEscapePropagation: true,
  });

  const lines = getExplanationLines(result?.explanation);

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
