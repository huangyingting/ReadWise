"use client";

/**
 * ListDeleteControl — shared delete button + confirmation for reading lists.
 *
 * Wraps ConfirmAction with the delete API call so the network path and error
 * message live in one place rather than being duplicated across ListRow and
 * MobileListManager.
 */

import { cn } from "@/lib/cn";
import { useReadingListMutations } from "@/hooks/useReadingListMutations";
import ConfirmAction from "@/components/ConfirmAction";

interface ListDeleteControlProps {
  listId: string;
  listName: string;
  onSuccess: () => void;
  /** Label on the trigger button. Defaults to "Delete". */
  triggerLabel?: string;
  /** Variant for the trigger button. Defaults to "outline". */
  triggerVariant?: "danger" | "danger-ghost" | "secondary" | "outline";
  size?: "sm" | "md";
  /** className forwarded to ConfirmAction (e.g. "!p-0"). */
  confirmClassName?: string;
  /** className on the outer wrapper element. */
  className?: string;
}

export function ListDeleteControl({
  listId,
  listName,
  onSuccess,
  triggerLabel = "Delete",
  triggerVariant = "outline",
  size = "sm",
  confirmClassName,
  className,
}: ListDeleteControlProps) {
  const { delete: deleteMut } = useReadingListMutations();

  async function handleConfirm() {
    const ok = await deleteMut.run(listId);
    if (ok) onSuccess();
  }

  return (
    <div className={cn("inline-flex flex-col items-start gap-[var(--space-1)]", className)}>
      <ConfirmAction
        triggerLabel={triggerLabel}
        triggerVariant={triggerVariant}
        size={size}
        confirmMessage={`Delete "${listName}"? Saved articles stay in your library; only this list is removed.`}
        confirmLabel="Delete"
        cancelLabel="Keep"
        confirmVariant="danger"
        loading={deleteMut.busy}
        onConfirm={handleConfirm}
        className={confirmClassName}
      />
      {deleteMut.error ? (
        <p role="alert" className="text-[length:var(--text-xs)] text-danger-text m-0">
          {deleteMut.error}
        </p>
      ) : null}
    </div>
  );
}
