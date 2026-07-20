"use client";

import { useId, useRef, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Field, Switch, Textarea } from "@/components/ui";
import { Popover } from "@/components/ui/Popover";
import { MAX_RECOVER_REASON, isRecoverReasonValid } from "@/lib/scraper/incremental/deleted-article-ui";

interface DeletedRecoverButtonProps {
  /** Runs the recovery with the required audit reason (confirm is enforced here). */
  onRun: (reason: string) => void | Promise<void>;
  busy?: boolean;
  disabled?: boolean;
  size?: "sm" | "md";
}

/**
 * Explicit deleted-identity recovery control (#1104, AC2). Mirrors the review
 * reason+confirm destructive-action pattern (`ReviewActionButton`): the trigger
 * opens a Popover that REQUIRES an audit reason (1–500 chars) AND an explicit
 * confirm toggle before the recovery runs (the API rejects `confirm:false`).
 * Recovery re-admits the identity for re-ingestion — it is NOT a content restore.
 * Fully keyboard-operable: the Popover traps focus, closes on Esc, and returns
 * focus to the trigger.
 */
export default function DeletedRecoverButton({
  onRun,
  busy = false,
  disabled = false,
  size = "sm",
}: DeletedRecoverButtonProps) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const reasonInputRef = useRef<HTMLTextAreaElement>(null);
  const reasonFieldId = useId();

  const trimmed = reason.trim();
  const reasonValid = isRecoverReasonValid(reason);
  const canSubmit = reasonValid && confirm && !busy;

  function reset() {
    setReason("");
    setConfirm(false);
  }

  async function runRecovery() {
    if (!canSubmit) return;
    await onRun(trimmed);
    setOpen(false);
    reset();
  }

  return (
    <>
      <Button
        ref={anchorRef}
        variant="primary"
        size={size}
        loading={busy}
        disabled={disabled || busy}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        Recover
      </Button>

      <Popover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={anchorRef}
        align="end"
        label="Recover deleted identity — reason required"
        initialFocusRef={reasonInputRef}
        className="w-[min(360px,90vw)] p-[var(--space-4)]"
      >
        <div className="flex flex-col gap-[var(--space-3)]">
          <Field
            label="Reason to recover"
            hint="Recorded in the audit log (1–500 characters). Never include private content."
            required
          >
            <Textarea
              ref={reasonInputRef}
              id={reasonFieldId}
              rows={3}
              maxLength={MAX_RECOVER_REASON}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why is this identity being re-admitted?"
            />
          </Field>

          <label className="flex items-start gap-[var(--space-2)] text-[length:var(--text-sm)]">
            <Switch
              checked={confirm}
              onCheckedChange={setConfirm}
              aria-label="Confirm re-admission for re-ingestion"
            />
            <span>
              I understand this re-admits the identity for re-ingestion (not a content
              restore).
            </span>
          </label>

          <div className="flex justify-end gap-[var(--space-2)]">
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              loading={busy}
              disabled={!canSubmit}
              onClick={runRecovery}
            >
              Confirm recovery
            </Button>
          </div>
        </div>
      </Popover>
    </>
  );
}
