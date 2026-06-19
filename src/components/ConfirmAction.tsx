"use client";

import { useState, useRef, useEffect, useId } from "react";
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
  /**
   * Controlled open state. When provided, the component is fully controlled:
   * the trigger still toggles open, but callers can also set it externally
   * (e.g., to enforce mutual exclusion between sibling panels).
   */
  open?: boolean;
  /** Required alongside `open`. Called when the panel requests an open/close. */
  onOpenChange?: (open: boolean) => void;
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
  open: controlledOpen,
  onOpenChange,
}: ConfirmActionProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const isOpen = isControlled ? controlledOpen : internalOpen;

  const triggerRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const msgId = useId();

  function setIsOpen(v: boolean) {
    if (isControlled) {
      onOpenChange?.(v);
    } else {
      setInternalOpen(v);
    }
  }

  // Focus the Cancel button when the panel opens (safer default for destructive actions).
  useEffect(() => {
    if (isOpen) {
      cancelRef.current?.focus();
    }
  }, [isOpen]);

  function handleClose() {
    setIsOpen(false);
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
      setIsOpen(false);
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
        aria-expanded={isOpen}
        onClick={() => setIsOpen(!isOpen)}
      >
        {triggerLabel}
      </Button>

      {isOpen && (
        <div
          className="admin-confirm"
          role="alertdialog"
          aria-label={`Confirm ${triggerLabel.toLowerCase()}`}
          aria-describedby={msgId}
          onKeyDown={handleKeyDown}
        >
          <p id={msgId} className="m-0 text-[length:var(--text-sm)]">{confirmMessage}</p>
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
