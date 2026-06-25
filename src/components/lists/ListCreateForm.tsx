"use client";

/**
 * ListCreateForm — shared inline form for creating a new reading list.
 *
 * Used by the desktop sidebar, mobile view in ListSwitcher, and the
 * ListPickerPopover so that validation, pending state, and API call exist in
 * one place rather than three.
 *
 * On success, onSuccess receives the newly-created list so callers can
 * navigate to it, add an article, or update local state as needed.
 *
 * Accessibility: input is auto-focused on mount; Escape triggers onCancel;
 * aria-describedby links the input to the error message.
 */

import { useState, useId } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/cn";
import { validateListName } from "@/lib/list-name-validation";
import { useReadingListMutations, type CreatedList } from "@/hooks/useReadingListMutations";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

interface ListCreateFormProps {
  /**
   * Called with the created list on success. Callers decide whether to
   * navigate, add an article, update local state, etc.
   */
  onSuccess: (list: CreatedList) => void;
  onCancel: () => void;
  /** className forwarded to the wrapping <form> element. */
  className?: string;
}

export function ListCreateForm({ onSuccess, onCancel, className }: ListCreateFormProps) {
  const [name, setName] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const { create } = useReadingListMutations();
  const errorId = useId();
  const displayError = validationError ?? create.error;

  async function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault();
    const validErr = validateListName(name);
    if (validErr) {
      setValidationError(validErr);
      return;
    }
    setValidationError(null);
    const created = await create.run(name.trim());
    if (created) onSuccess(created);
  }

  return (
    <form
      onSubmit={(e) => void handleSubmit(e)}
      className={cn("flex flex-col gap-[var(--space-1)]", className)}
    >
      <Input
        inputSize="sm"
        placeholder="List name…"
        value={name}
        maxLength={60}
        autoFocus
        onChange={(e) => {
          setName(e.target.value);
          setValidationError(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancel();
        }}
        aria-label="New list name"
        aria-describedby={displayError ? errorId : undefined}
        invalid={displayError ? true : false}
      />
      {displayError ? (
        <p id={errorId} className="text-[length:var(--text-xs)] text-danger-text m-0">
          {displayError}
        </p>
      ) : null}
      <div className="flex gap-[var(--space-1)]">
        <Button
          type="submit"
          size="sm"
          variant="primary"
          loading={create.busy}
          disabled={!name.trim()}
          leadingIcon={<Check size={14} aria-hidden />}
        >
          Create
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={create.busy}
          onClick={onCancel}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
