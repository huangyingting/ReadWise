"use client";

import { useEffect, useRef } from "react";
import { Keyboard } from "lucide-react";
import { cn, focusRing } from "@/lib/cn";
import { SHORTCUT_GROUPS, type ShortcutGroup } from "@/lib/keyboard-shortcuts";

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

  // Focus the close button when the modal opens.
  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  // Keyboard handling: Esc to close + focus trap. Registered in the CAPTURE
  // phase so this topmost overlay sees the key first; on Esc we
  // stopImmediatePropagation so a background overlay (e.g. the More sheet this
  // modal can open on top of) doesn't ALSO close on the same keypress.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        onClose();
        return;
      }

      if (e.key === "Tab" && dialogRef.current) {
        const focusable = Array.from(
          dialogRef.current.querySelectorAll<HTMLElement>(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
          ),
        ).filter((el) => el.tabIndex >= 0);
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    }

    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-[var(--space-4)]"
      style={{ backgroundColor: "rgba(0,0,0,0.55)", backdropFilter: "blur(2px)" }}
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
