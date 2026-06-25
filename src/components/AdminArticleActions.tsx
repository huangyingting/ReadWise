"use client";

import { useState } from "react";
import { deleteJson, postJson } from "@/lib/client-fetch";
import ConfirmAction from "@/components/ConfirmAction";
import { useAdminAction } from "@/hooks/useAdminAction";

export default function AdminArticleActions({
  articleId,
  redirectOnDelete,
}: {
  articleId: string;
  redirectOnDelete?: string;
}) {
  const { busy, error, openPanel, setOpenPanel, run, router } =
    useAdminAction<"rebuild" | "delete">();
  const [message, setMessage] = useState<string | null>(null);

  async function runRebuild() {
    setMessage(null);
    await run("rebuild", async () => {
      const data = await postJson<{
        cleared?: Record<string, number>;
      }>(`/api/admin/articles/${articleId}/rebuild`);
      const total = data.cleared
        ? Object.values(data.cleared).reduce((sum, n) => sum + n, 0)
        : 0;
      setMessage(
        `Rebuild queued — cleared ${total} cached item(s); AI content will regenerate on next read.`,
      );
    });
  }

  async function runDelete() {
    setMessage(null);
    await run("delete", async () => {
      await deleteJson(`/api/admin/articles/${articleId}`);
      if (redirectOnDelete) {
        router.push(redirectOnDelete);
      }
    }, { skipRefresh: !!redirectOnDelete });
  }

  return (
    <div className="admin-actions">
      <div className="admin-actions-row">
        <ConfirmAction
          triggerLabel="Rebuild AI content"
          triggerVariant="secondary"
          confirmVariant="primary"
          confirmLabel="Confirm rebuild"
          confirmMessage="Clear cached translations, vocabulary, quiz, narration and tags for this article? They will be regenerated on the next read."
          onConfirm={runRebuild}
          loading={busy === "rebuild"}
          disabled={busy === "delete"}
          open={openPanel === "rebuild"}
          onOpenChange={(v) => setOpenPanel(v ? "rebuild" : null)}
        />
        <ConfirmAction
          triggerLabel="Delete"
          triggerVariant="danger-ghost"
          confirmVariant="danger"
          confirmLabel="Confirm delete"
          confirmMessage="Permanently delete this article and all related AI content, tags and reader progress? This cannot be undone."
          onConfirm={runDelete}
          loading={busy === "delete"}
          disabled={busy === "rebuild"}
          open={openPanel === "delete"}
          onOpenChange={(v) => setOpenPanel(v ? "delete" : null)}
        />
      </div>

      {message && (
        <p className="muted" style={{ margin: 0 }}>
          {message}
        </p>
      )}
      {error && (
        <p
          className="text-danger-text text-[length:var(--text-sm)]"
          style={{ margin: 0 }}
        >
          {error}
        </p>
      )}
    </div>
  );
}
