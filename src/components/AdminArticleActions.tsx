"use client";

import { useState } from "react";
import { deleteJson, postJson } from "@/lib/client-fetch";
import ConfirmAction from "@/components/ConfirmAction";
import { useAdminAction } from "@/hooks/useAdminAction";

type ArticleAction = "rebuild" | "delete";
type RebuildResponse = {
  cleared?: Record<string, number>;
};

const REBUILD_COMPLETE_MESSAGE =
  "Rebuild queued — cleared %d cached item(s); AI content will regenerate on next read.";

function countClearedItems(cleared?: Record<string, number>): number {
  return cleared
    ? Object.values(cleared).reduce((sum, count) => sum + count, 0)
    : 0;
}

function rebuildCompleteMessage(total: number): string {
  return REBUILD_COMPLETE_MESSAGE.replace("%d", String(total));
}

export default function AdminArticleActions({
  articleId,
  redirectOnDelete,
}: {
  articleId: string;
  redirectOnDelete?: string;
}) {
  const { busy, error, openPanel, setOpenPanel, run, router } =
    useAdminAction<ArticleAction>();
  const [message, setMessage] = useState<string | null>(null);

  const setPanelOpen = (panel: ArticleAction) => (open: boolean) => {
    setOpenPanel(open ? panel : null);
  };

  async function runRebuild() {
    setMessage(null);
    await run("rebuild", async () => {
      const data = await postJson<RebuildResponse>(
        `/api/admin/articles/${articleId}/rebuild`,
      );
      setMessage(rebuildCompleteMessage(countClearedItems(data.cleared)));
    });
  }

  async function runDelete() {
    setMessage(null);
    await run("delete", async () => {
      await deleteJson(`/api/admin/articles/${articleId}`);
      if (redirectOnDelete) {
        router.push(redirectOnDelete);
      }
    }, { skipRefresh: Boolean(redirectOnDelete) });
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
          onOpenChange={setPanelOpen("rebuild")}
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
          onOpenChange={setPanelOpen("delete")}
        />
      </div>

      {message && (
        <p className="muted m-0">
          {message}
        </p>
      )}
      {error && (
        <p className="m-0 text-danger-text text-[length:var(--text-sm)]">
          {error}
        </p>
      )}
    </div>
  );
}
