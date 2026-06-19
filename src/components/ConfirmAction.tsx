"use client";

import { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/Button";

export interface ConfirmActionProps {
  /** Label for the trigger button (shown in its resting state). */
  triggerLabel: string;
  /** Variant for the trigger button. Defaults to "danger". */
  triggerVariant?: "danger" | "secondary" | "outline";
  /** Size of both buttons. Defaults to "sm". */
  size?: "sm" | "md";
  /** Visible message inside the confirm panel. Required. */
  confirmMessage: React.ReactNode;
  /** Label for the confirm button. Defaults to "Confirm". */
  confirmLabel?: string;
  /** Label for the cancel button. Defaults to "Cancel". */
  cancelLabel?: string;
  /** Variant for the confirm button — always dangerous, defaults to "danger". */
  confirmVariant?: "danger" | "primary";
  /** Called when the user confirms. Should handle its own error state. */
  onConfirm: () => Promise<void>;
  /** Whether the action is in-flight (shows loading spinner on confirm button). */
  loading?: boolean;
  /** Disable the trigger (e.g., self-protection). Shows title tooltip when provided. */
  disabled?: boolean;
  /** Tooltip on the trigger when disabled. */
  disabledTitle?: string;
  /** Optional additional className on the wrapper div. */
  className?: string;
}

export default function ConfirmAction({
  triggerLabel,
  triggerVariant = "danger",
  size = "sm",
  confirmMessage,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  confirmVariant = "danger",
  onConfirm,
  loading = false,
  disabled = false,
  disabledTitle,
  className,
}: ConfirmActionProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Focus the Cancel button when the panel opens (safer default for destructive actions).
  useEffect(() => {
    if (open) {
      cancelRef.current?.focus();
    }
  }, [open]);

  function handleClose() {
    setOpen(false);
    // Return focus to the trigger after the panel unmounts.
    setTimeout(() => triggerRef.current?.focus(), 0);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      handleClose();
    }
  }

  async function handleConfirm() {
    try {
      await onConfirm();
    } finally {
      setOpen(false);
      setTimeout(() => triggerRef.current?.focus(), 0);
    }
  }

  return (
    <div className={cn("admin-actions", className)}>
      <Button
        ref={triggerRef}
        variant={triggerVariant}
        size={size}
        disabled={disabled || loading}
        title={disabled && disabledTitle ? disabledTitle : undefined}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {triggerLabel}
      </Button>

      {open && (
        <div
          className="admin-confirm"
          role="alertdialog"
          aria-label={`Confirm ${triggerLabel.toLowerCase()}`}
          onKeyDown={handleKeyDown}
        >
          <p className="m-0 text-[length:var(--text-sm)]">{confirmMessage}</p>
          <div className="admin-actions-row">
            <Button
              variant={confirmVariant}
              size={size}
              loading={loading}
              aria-busy={loading}
              onClick={handleConfirm}
            >
              {confirmLabel}
            </Button>
            <Button
              ref={cancelRef}
              variant="outline"
              size={size}
              disabled={loading}
              onClick={handleClose}
            >
              {cancelLabel}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
