"use client";

import { useRef } from "react";
import { Keyboard } from "lucide-react";
import { cn, focusRing } from "@/lib/cn";
import { SHORTCUT_GROUPS, type ShortcutGroup } from "@/lib/keyboard-shortcuts";
import { useFocusTrap } from "@/lib/focus-trap";

// ---------------------------------------------------------------------------
// Internal sub-components
// ---------------------------------------------------------------------------

function KbdList({ keys }: { keys: string[] }) {
  return (
    <span className="inline-flex items-center gap-[var(--space-1)] shrink-0">
      {keys.map((k, i) => (
        <kbd key={i} className="kbd">
          {k}
        </kbd>
      ))}
    </span>
  );
}

function ShortcutRow({
  keys,
  description,
}: {
  keys: string[];
  description: string;
}) {
  return (
    <li className="flex items-center justify-between gap-[var(--space-4)] py-[var(--space-2)]">
      <span className="text-[length:var(--text-sm)] text-text">{description}</span>
      <KbdList keys={keys} />
    </li>
  );
}

function ShortcutSection({ group }: { group: ShortcutGroup }) {
  return (
    <section aria-labelledby={`ks-${group.label}`}>
      <h3
        id={`ks-${group.label}`}
        className="text-[length:var(--text-xs)] font-semibold uppercase tracking-widest text-text-subtle mb-[var(--space-2)]"
      >
        {group.label}
      </h3>
      <ul
        className="divide-y divide-border"
        aria-label={`${group.label} shortcuts`}
      >
        {group.shortcuts.map((s) => (
          <ShortcutRow key={s.description} keys={s.keys} description={s.description} />
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

interface KeyboardShortcutsModalProps {
  onClose: () => void;
}

/**
 * Accessible keyboard shortcuts reference panel.
 *
 * - role="dialog" / aria-modal
 * - Focus trap (Tab cycles within the modal)
 * - Esc closes
 * - Click on backdrop closes
 */
export default function KeyboardShortcutsModal({
  onClose,
}: KeyboardShortcutsModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // Focus trap: capture phase + stopImmediatePropagation so a background overlay
  // (e.g. the More sheet) doesn't also close when this modal handles Escape.
  useFocusTrap(dialogRef, true, onClose, {
    capture: true,
    stopEscapePropagation: true,
    initialFocusRef: closeButtonRef,
  });

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-[var(--z-top)] flex items-center justify-center p-[var(--space-4)]"
      style={{ backgroundColor: "var(--overlay)", backdropFilter: "blur(2px)" }}
      onMouseDown={(e) => {
        // Close on backdrop click (but not on dialog click)
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Dialog */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ks-title"
        className={cn(
          "relative w-full max-w-lg max-h-[90dvh] overflow-y-auto",
          "rounded-[var(--radius-lg)] border border-border bg-surface-raised",
          "shadow-[var(--shadow-lg)]",
          "p-[var(--space-6)]",
          "motion-reduce:transition-none",
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-[var(--space-6)]">
          <div className="flex items-center gap-[var(--space-3)]">
            <Keyboard size={20} className="text-text-subtle" aria-hidden />
            <h2
              id="ks-title"
              className="font-[family-name:var(--font-display)] font-semibold text-[length:var(--text-xl)] text-text"
            >
              Keyboard shortcuts
            </h2>
          </div>

          <button
            ref={closeButtonRef}
            type="button"
            aria-label="Close keyboard shortcuts"
            onClick={onClose}
            className={cn(
              "inline-flex items-center justify-center w-8 h-8",
              "rounded-[var(--radius-md)]",
              "text-text-subtle hover:text-text hover:bg-bg-subtle",
              "transition-colors [transition-duration:var(--duration-fast)]",
              focusRing,
            )}
          >
            <span aria-hidden className="text-[length:var(--text-base)] leading-none">
              ×
            </span>
          </button>
        </div>

        {/* Shortcut groups */}
        <div className="flex flex-col gap-[var(--space-6)]">
          {SHORTCUT_GROUPS.map((group) => (
            <ShortcutSection key={group.label} group={group} />
          ))}
        </div>
      </div>
    </div>
  );
}
