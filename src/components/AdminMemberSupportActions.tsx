"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { postJson } from "@/lib/client-fetch";
import { Button } from "@/components/ui/Button";
import ConfirmAction from "@/components/ConfirmAction";

type Busy = null | "revoke" | "export" | "repair" | "resend";
type SupportAction = "revoke_sessions" | "export" | "repair" | "resend_help";
type SupportResponse = Record<string, unknown>;

function downloadMemberExport(memberId: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `member-${memberId}-export.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

/**
 * Client controls for the admin member-support actions (RW-053): revoke all
 * sessions, export the member's data, trigger an enrichment repair, and resend
 * sign-in help. Each POSTs to `/api/admin/members/[id]/support`; destructive
 * actions use the inline confirm pattern. Disabled when acting on yourself
 * where it would be unsafe (session revoke).
 */
export default function AdminMemberSupportActions({
  memberId,
  isSelf,
}: {
  memberId: string;
  isSelf: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function postSupportAction(
    action: SupportAction,
    busyKey: Exclude<Busy, null>,
  ): Promise<SupportResponse | null> {
    setBusy(busyKey);
    setError(null);
    setMessage(null);
    try {
      return await postJson<SupportResponse>(
        `/api/admin/members/${memberId}/support`,
        { action },
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function revoke() {
    const data = await postSupportAction("revoke_sessions", "revoke");
    if (data) {
      setMessage(`Revoked ${data.revoked ?? 0} session(s).`);
      router.refresh();
    }
  }

  async function exportData() {
    const data = await postSupportAction("export", "export");
    if (data?.data) {
      downloadMemberExport(memberId, data.data);
      setMessage("Export downloaded.");
    }
  }

  async function repair() {
    const data = await postSupportAction("repair", "repair");
    if (data) {
      setMessage(
        `Repair queued: ${data.enqueued ?? 0} job(s) across ${data.articleCount ?? 0} article(s).`,
      );
      router.refresh();
    }
  }

  async function resend() {
    const data = await postSupportAction("resend_help", "resend");
    if (data) {
      setMessage(
        data.delivered
          ? "Sign-in help sent."
          : "Email delivery is not configured in this deployment; the request was logged.",
      );
    }
  }

  return (
    <div className="stack">
      <div className="flex flex-wrap gap-[var(--space-2)] items-center">
        <ConfirmAction
          triggerLabel="Revoke sessions"
          triggerVariant="danger-ghost"
          confirmVariant="danger"
          confirmLabel="Revoke all sessions"
          confirmMessage="Sign this member out of all devices? They will need to sign in again."
          onConfirm={revoke}
          loading={busy === "revoke"}
          disabled={isSelf || busy !== null}
          disabledTitle={isSelf ? "You cannot revoke your own sessions here" : undefined}
        />

        <Button
          variant="outline"
          size="sm"
          loading={busy === "export"}
          disabled={busy !== null}
          onClick={exportData}
        >
          Export data
        </Button>

        <ConfirmAction
          triggerLabel="Repair content"
          triggerVariant="secondary"
          confirmVariant="primary"
          confirmLabel="Queue repair"
          confirmMessage="Re-enqueue missing AI enrichment for this member's imported articles? User study data is never touched."
          onConfirm={repair}
          loading={busy === "repair"}
          disabled={busy !== null}
        />

        <Button
          variant="outline"
          size="sm"
          loading={busy === "resend"}
          disabled={busy !== null}
          onClick={resend}
        >
          Resend sign-in help
        </Button>
      </div>

      {message && (
        <p className="text-[length:var(--text-sm)] text-text-muted" style={{ margin: 0 }}>
          {message}
        </p>
      )}
      {error && (
        <p className="text-danger-text text-[length:var(--text-sm)]" style={{ margin: 0 }}>
          {error}
        </p>
      )}
    </div>
  );
}
