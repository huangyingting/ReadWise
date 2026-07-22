"use client";

import { useState, type ComponentProps } from "react";
import { Plus, X } from "lucide-react";
import { Button, IconButton, Sheet } from "@/components/ui";
import AssignArticleForm from "./AssignArticleForm";

type AssignReadingSheetProps = Omit<
  ComponentProps<typeof AssignArticleForm>,
  "onAssigned"
>;

export default function AssignReadingSheet(props: AssignReadingSheetProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        variant="primary"
        size="md"
        leadingIcon={<Plus size={16} aria-hidden />}
        onClick={() => setOpen(true)}
      >
        Assign reading
      </Button>

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        side="right"
        label="Assign a reading"
      >
        <div className="flex items-center justify-between gap-[var(--space-4)] border-b border-border px-[var(--space-5)] py-[var(--space-4)]">
          <h2 className="m-0 text-[length:var(--text-lg)] font-semibold text-text">
            Assign a reading
          </h2>
          <IconButton
            aria-label="Close assignment form"
            className="min-h-[44px] min-w-[44px] sm:min-h-8 sm:min-w-8"
            onClick={() => setOpen(false)}
          >
            <X size={18} aria-hidden />
          </IconButton>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-[var(--space-5)] py-[var(--space-4)]">
          <AssignArticleForm {...props} onAssigned={() => setOpen(false)} />
        </div>
      </Sheet>
    </>
  );
}