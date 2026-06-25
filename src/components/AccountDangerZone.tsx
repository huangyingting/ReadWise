"use client";

import { useState } from "react";
import { signOut } from "next-auth/react";
import { deleteJson } from "@/lib/client-fetch";
import ConfirmAction from "@/components/ConfirmAction";
import { buttonVariants } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { purgeOfflineUserData } from "@/lib/offline/sync-runtime";

export default function AccountDangerZone() {
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function handleDelete() {
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await deleteJson("/api/account");
      // Session is now invalid server-side — purge offline data then sign out.
      await purgeOfflineUserData();
      await signOut({ callbackUrl: "/signin" });
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Deletion failed");
    } finally {
      setDeleteBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-[var(--space-4)]">
      {/* ── Data export ── */}
      <div className="flex flex-col gap-[var(--space-2)]">
        <p className="text-text text-[length:var(--text-sm)] font-medium m-0">
          Export my data
        </p>
        <p className="text-text-muted text-[length:var(--text-sm)] m-0">
          Download a complete JSON archive of your profile, reading progress, saved words,
          highlights, quiz history, and more.
        </p>
        <div>
          <a
            href="/api/account/export"
            download
            className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
          >
            Download export
          </a>
        </div>
      </div>

      {/* ── Account deletion ── */}
      <div
        className="flex flex-col gap-[var(--space-2)]"
        style={{ paddingTop: "var(--space-4)", borderTop: "1px solid var(--border)" }}
      >
        <p
          className="text-[length:var(--text-sm)] font-medium m-0"
          style={{ color: "var(--danger, #dc2626)" }}
        >
          Delete account
        </p>
        <p className="text-text-muted text-[length:var(--text-sm)] m-0">
          Permanently delete your account and all associated data. This action{" "}
          <strong>cannot be undone</strong>. Your reading progress, saved words,
          highlights, and profile will be erased immediately.
        </p>

        {deleteError && (
          <p
            className="text-[length:var(--text-sm)] m-0"
            role="alert"
            style={{ color: "var(--danger, #dc2626)" }}
          >
            {deleteError}
          </p>
        )}

        <div>
          <ConfirmAction
            triggerLabel="Delete my account"
            triggerVariant="danger"
            size="sm"
            confirmMessage={
              <span>
                Are you sure? This will <strong>permanently delete</strong> your account
                and all your data. There is no way to recover it.
              </span>
            }
            confirmKeyword="DELETE"
            confirmLabel="Yes, delete my account"
            cancelLabel="Cancel"
            confirmVariant="danger"
            onConfirm={handleDelete}
            loading={deleteBusy}
          />
        </div>
      </div>
    </div>
  );
}
