"use client";

/**
 * Shared mutation hook and form shell for teacher action forms (RW-061).
 *
 * All four teacher *Form.tsx components share the same mutation + layout
 * pattern: `useMutation` for state, `postJson` for the API call,
 * `Field/Input/Button` primitives, and a `<form>` wrapper with a submit
 * button row. This module extracts that repeated structure so each form
 * only needs to declare its own fields and submission logic.
 */

import { useMutation } from "@/hooks/useMutation";
import { Button } from "@/components/ui/Button";

// Re-export so consumers can import from one place.
export { useMutation as useTeacherMutation };

export interface TeacherFormShellProps {
  /** Form submit handler — called with the native FormEvent. */
  onSubmit: (e: React.FormEvent) => void;
  /** Whether an async operation is in progress. */
  busy: boolean;
  /** Whether all required fields are filled and valid. */
  canSubmit: boolean;
  /** Label shown on the submit button when idle. */
  submitLabel: string;
  /** Label shown on the submit button while `busy`. */
  busyLabel: string;
  /** Size forwarded to the submit Button. Defaults to "sm". */
  buttonSize?: "sm" | "md" | "lg";
  /** Form field content. */
  children: React.ReactNode;
}

/**
 * Thin form shell shared by all teacher *Form.tsx components.
 *
 * Renders a `<form>` with the standard `flex flex-col gap` layout, the
 * provided field children, and a footer submit button that reflects busy /
 * canSubmit state.
 */
export function TeacherFormShell({
  onSubmit,
  busy,
  canSubmit,
  submitLabel,
  busyLabel,
  buttonSize = "sm",
  children,
}: TeacherFormShellProps) {
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-[var(--space-3)]">
      {children}
      <div>
        <Button type="submit" size={buttonSize} disabled={busy || !canSubmit}>
          {busy ? busyLabel : submitLabel}
        </Button>
      </div>
    </form>
  );
}
