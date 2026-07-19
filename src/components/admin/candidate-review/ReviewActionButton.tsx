"use client";

import { useId, useRef, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Field, Textarea, Tooltip } from "@/components/ui";
import { Popover } from "@/components/ui/Popover";
import {
  REVIEW_ACTION_LABELS,
  reviewActionNeedsReason,
  type CandidateReviewAction,
} from "@/lib/scraper/incremental/candidate-review-ui";

const MAX_REASON = 500;

interface ReviewActionButtonProps {
  action: CandidateReviewAction;
  /** Runs the action; `reason` is provided for reject/reactivate. */
  onRun: (action: CandidateReviewAction, reason?: string) => void | Promise<void>;
  variant: "primary" | "secondary" | "danger" | "outline" | "ghost";
  size?: "sm" | "md";
  busy?: boolean;
  disabled?: boolean;
  /** Tooltip explaining why the control is disabled. */
  disabledReason?: string;
  /** Optional selection count — turns the label into a batch label. */
  count?: number;
}

/**
 * A single review-action control. `approve` runs immediately; `reject` and
 * `reactivate` are policy-sensitive and open a Popover requiring an audit reason
 * (1–500 chars) before running. Reused for both per-row and bounded-batch
 * actions — pass `count` for the batch variant. Fully keyboard-operable: the
 * Popover traps focus, closes on Esc, and returns focus to the trigger.
 */
export default function ReviewActionButton({
  action,
  onRun,
  variant,
  size = "sm",
  busy = false,
  disabled = false,
  disabledReason,
  count,
}: ReviewActionButtonProps) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const anchorRef = useRef<HTMLButtonElement>(null);
  const reasonInputRef = useRef<HTMLTextAreaElement>(null);
  const reasonFieldId = useId();

  const needsReason = reviewActionNeedsReason(action);
  const baseLabel = REVIEW_ACTION_LABELS[action];
  const label = count && count > 1 ? `${baseLabel} ${count}` : baseLabel;
  const trimmed = reason.trim();
  const reasonValid = trimmed.length >= 1 && trimmed.length <= MAX_REASON;

  async function runDirect() {
    await onRun(action);
  }

  async function runWithReason() {
    if (!reasonValid) return;
    await onRun(action, trimmed);
    setOpen(false);
    setReason("");
  }

  const trigger = (
    <Button
      ref={anchorRef}
      variant={variant}
      size={size}
      loading={busy}
      disabled={disabled || busy}
      aria-expanded={needsReason ? open : undefined}
      onClick={needsReason ? () => setOpen((v) => !v) : runDirect}
    >
      {label}
    </Button>
  );

  return (
    <>
      {disabled && disabledReason ? <Tooltip content={disabledReason}>{trigger}</Tooltip> : trigger}

      {needsReason && (
        <Popover
          open={open}
          onClose={() => setOpen(false)}
          anchorRef={anchorRef}
          align="end"
          label={`${baseLabel} — reason required`}
          initialFocusRef={reasonInputRef}
          className="w-[min(340px,90vw)] p-[var(--space-4)]"
        >
          <div className="flex flex-col gap-[var(--space-3)]">
            <Field
              label={`Reason to ${baseLabel.toLowerCase()}${count && count > 1 ? ` ${count} candidates` : ""}`}
              hint="Recorded in the audit log (1–500 characters). Never include private content."
              required
            >
              <Textarea
                ref={reasonInputRef}
                id={reasonFieldId}
                rows={3}
                maxLength={MAX_REASON}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Why is this decision being made?"
              />
            </Field>
            <div className="flex justify-end gap-[var(--space-2)]">
              <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                variant={variant === "outline" ? "primary" : variant}
                size="sm"
                loading={busy}
                disabled={!reasonValid || busy}
                onClick={runWithReason}
              >
                Confirm {baseLabel.toLowerCase()}
              </Button>
            </div>
          </div>
        </Popover>
      )}
    </>
  );
}
