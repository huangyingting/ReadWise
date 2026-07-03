"use client";

/**
 * ListRenameForm — shared rename form for reading lists.
 *
 * Used by both the desktop ListRow and mobile MobileListManager to avoid
 * duplicating rename state, validation, and API calls.
 *
 * The parent controls when to mount/unmount this component (e.g., toggling a
 * `renaming` state). Unmounting the component resets all internal form state.
 *
 * Accessibility: Escape triggers onCancel; aria-label and aria-describedby are
 * wired to the input for screen-reader error announcements.
 */

import {
  useState,
  useId,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/cn";
import { validateListName } from "@/lib/list-name-validation";
import { useReadingListMutations } from "@/hooks/useReadingListMutations";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

interface ListRenameFormProps {
  list: { id: string; name: string };
  onSuccess: () => void;
  onCancel: () => void;
  /** Auto-focus the input on mount. Use when the form is revealed by a click. */
  autoFocus?: boolean;
  /** className forwarded to the wrapping <form> element. */
  className?: string;
}

const LIST_NAME_MAX_LENGTH = 60;

export function ListRenameForm({
  list,
  onSuccess,
  onCancel,
  autoFocus,
  className,
}: ListRenameFormProps) {
  const [value, setValue] = useState(list.name);
  const [validationError, setValidationError] = useState<string | null>(null);
  const { rename } = useReadingListMutations();
  const errorId = useId();
  const displayError = validationError ?? rename.error;
  const describedBy = displayError ? errorId : undefined;

  async function handleSubmit(e?: FormEvent) {
    e?.preventDefault();
    const trimmed = value.trim();

    const validErr = validateListName(value);
    if (validErr) {
      setValidationError(validErr);
      return;
    }

    if (trimmed === list.name) {
      onCancel();
      return;
    }

    setValidationError(null);
    const ok = await rename.run(list.id, trimmed);
    if (ok) onSuccess();
  }

  function handleValueChange(e: ChangeEvent<HTMLInputElement>) {
    setValue(e.target.value);
    setValidationError(null);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") onCancel();
  }

  return (
    <form
      onSubmit={(e) => void handleSubmit(e)}
      className={cn("flex flex-col gap-[var(--space-1)]", className)}
    >
      <Input
        inputSize="sm"
        value={value}
        maxLength={LIST_NAME_MAX_LENGTH}
        autoFocus={autoFocus}
        onChange={handleValueChange}
        onKeyDown={handleKeyDown}
        aria-label={`Rename ${list.name}`}
        aria-describedby={describedBy}
        invalid={Boolean(displayError)}
      />
      {displayError ? (
        <p
          id={errorId}
          className="text-[length:var(--text-xs)] text-danger-text m-0"
        >
          {displayError}
        </p>
      ) : null}
      <div className="flex gap-[var(--space-1)]">
        <Button
          type="submit"
          size="sm"
          variant="primary"
          loading={rename.busy}
          disabled={!value.trim()}
          leadingIcon={<Check size={12} aria-hidden />}
        >
          Save
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={rename.busy}
          onClick={onCancel}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
