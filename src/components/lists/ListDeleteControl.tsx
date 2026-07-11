"use client";

/**
 * ListDeleteControl — shared delete button + confirmation for reading lists.
 *
 * Wraps ConfirmAction with the delete API call so the network path and error
 * message live in one place rather than being duplicated across ListRow and
 * MobileListManager.
 */

import { cn } from "@/lib/cn";
import { useReadingListMutations } from "./useReadingListMutations";
import ConfirmAction from "@/components/ConfirmAction";

type TriggerVariant = "danger" | "danger-ghost" | "secondary" | "outline";
type ControlSize = "sm" | "md";

const DEFAULT_TRIGGER_LABEL = "Delete";
const DEFAULT_TRIGGER_VARIANT: TriggerVariant = "outline";
const DEFAULT_SIZE: ControlSize = "sm";
const ROOT_CLASS_NAME = "inline-flex flex-col items-start gap-[var(--space-1)]";

interface ListDeleteControlProps {
  listId: string;
  listName: string;
  onSuccess: () => void;
  /** Label on the trigger button. Defaults to "Delete". */
  triggerLabel?: string;
  /** Variant for the trigger button. Defaults to "outline". */
  triggerVariant?: TriggerVariant;
  size?: ControlSize;
  /** className forwarded to ConfirmAction (e.g. "!p-0"). */
  confirmClassName?: string;
  /** className on the outer wrapper element. */
  className?: string;
}

function getConfirmMessage(listName: string) {
  return `Delete "${listName}"? Saved articles stay in your library; only this list is removed.`;
}

function DeleteErrorMessage({ message }: { message: string }) {
  return (
    <p role="alert" className="text-[length:var(--text-xs)] text-danger-text m-0">
      {message}
    </p>
  );
}

export function ListDeleteControl({
  listId,
  listName,
  onSuccess,
  triggerLabel = DEFAULT_TRIGGER_LABEL,
  triggerVariant = DEFAULT_TRIGGER_VARIANT,
  size = DEFAULT_SIZE,
  confirmClassName,
  className,
}: ListDeleteControlProps) {
  const { delete: deleteMut } = useReadingListMutations();

  async function handleConfirm() {
    const ok = await deleteMut.run(listId);
    if (ok) onSuccess();
  }

  return (
    <div className={cn(ROOT_CLASS_NAME, className)}>
      <ConfirmAction
        triggerLabel={triggerLabel}
        triggerVariant={triggerVariant}
        size={size}
        confirmMessage={getConfirmMessage(listName)}
        confirmLabel="Delete"
        cancelLabel="Keep"
        confirmVariant="danger"
        loading={deleteMut.busy}
        onConfirm={handleConfirm}
        className={confirmClassName}
      />
      {deleteMut.error ? <DeleteErrorMessage message={deleteMut.error} /> : null}
    </div>
  );
}
