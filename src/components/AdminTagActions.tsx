"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { deleteJson, getJson, patchJson, postJson } from "@/lib/client-fetch";
import ConfirmAction from "@/components/ConfirmAction";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { useMutation } from "@/hooks/useMutation";

type TagOption = { id: string; name: string };
type Panel = "rename" | "merge" | "delete" | null;

export default function AdminTagActions({
  tagId,
  tagName,
}: {
  tagId: string;
  tagName: string;
}) {
  const router = useRouter();
  const [openPanel, setOpenPanel] = useState<Panel>(null);
  const { busy, error, run, setError } = useMutation();

  // Rename state
  const [newName, setNewName] = useState(tagName);

  // Merge state
  const [tagOptions, setTagOptions] = useState<TagOption[] | null>(null);
  const [loadingTags, setLoadingTags] = useState(false);
  const [mergeTargetId, setMergeTargetId] = useState("");

  async function runTagAction(
    action: () => Promise<unknown>,
    fallbackMessage: string,
    onSuccess?: () => void,
  ) {
    const succeeded = await run(async () => {
      await action();
      return true;
    }, { fallbackMessage });
    if (!succeeded) return;
    onSuccess?.();
    router.refresh();
  }

  function clearError() {
    setError(null);
  }

  function openRename() {
    setNewName(tagName);
    clearError();
    setOpenPanel(openPanel === "rename" ? null : "rename");
  }

  async function openMerge() {
    clearError();
    if (openPanel === "merge") {
      setOpenPanel(null);
      return;
    }
    setOpenPanel("merge");
    if (!tagOptions) {
      setLoadingTags(true);
      try {
        const data = await getJson<TagOption[]>("/api/admin/tags");
        const others = data.filter((t) => t.id !== tagId);
        setTagOptions(others);
        setMergeTargetId(others[0]?.id ?? "");
      } catch {
        setError("Failed to load tags");
      } finally {
        setLoadingTags(false);
      }
    }
  }

  async function runRename() {
    await runTagAction(
      () => patchJson(`/api/admin/tags/${tagId}`, { name: newName }),
      "Rename failed",
      () => setOpenPanel(null),
    );
  }

  async function runMerge() {
    if (!mergeTargetId) return;
    await runTagAction(
      () => postJson(`/api/admin/tags/${tagId}/merge`, { targetId: mergeTargetId }),
      "Merge failed",
      () => setOpenPanel(null),
    );
  }

  async function runDelete() {
    await runTagAction(
      () => deleteJson(`/api/admin/tags/${tagId}`),
      "Delete failed",
    );
  }

  const mergeTarget = tagOptions?.find((t) => t.id === mergeTargetId);

  return (
    <div className="admin-actions">
      <div className="admin-actions-row">
        <Button
          size="sm"
          variant="outline"
          onClick={openRename}
          disabled={busy}
        >
          Rename
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={openMerge}
          disabled={busy}
        >
          Merge into…
        </Button>
        <ConfirmAction
          triggerLabel="Delete"
          triggerVariant="danger-ghost"
          confirmVariant="danger"
          confirmLabel="Confirm delete"
          confirmMessage={
            <>
              Delete the tag &quot;{tagName}&quot;? It will be removed from
              every article that carries it. This cannot be undone.
            </>
          }
          onConfirm={runDelete}
          loading={busy && openPanel === null}
          disabled={busy}
          open={openPanel === "delete"}
          onOpenChange={(v) => {
            clearError();
            setOpenPanel(v ? "delete" : null);
          }}
        />
      </div>

      {openPanel === "rename" && (
        <div className="admin-confirm">
          <p className="m-0">New name for &quot;{tagName}&quot;:</p>
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            inputSize="sm"
            aria-label="New tag name"
            onKeyDown={(e) => {
              if (e.key === "Enter") void runRename();
              if (e.key === "Escape") setOpenPanel(null);
            }}
            autoFocus
          />
          <div className="flex gap-[var(--space-2)]">
            <Button
              size="sm"
              variant="primary"
              onClick={runRename}
              disabled={busy || !newName.trim() || newName.trim() === tagName}
            >
              {busy ? "Saving…" : "Save"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setOpenPanel(null)}
              disabled={busy}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {openPanel === "merge" && (
        <div className="admin-confirm">
          <p className="m-0">
            Merge &quot;{tagName}&quot; into another tag:
          </p>
          {loadingTags ? (
            <p className="m-0 muted">
              Loading tags…
            </p>
          ) : tagOptions && tagOptions.length > 0 ? (
            <>
              <Select
                value={mergeTargetId}
                onChange={(e) => setMergeTargetId(e.target.value)}
                selectSize="sm"
                aria-label="Target tag to merge into"
              >
                {tagOptions.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
              <p className="m-0 text-[length:var(--text-sm)] text-text-muted">
                All articles tagged &quot;{tagName}&quot; will gain &quot;
                {mergeTarget?.name ?? "…"}&quot;. The original tag will be
                deleted.
              </p>
              <div className="flex gap-[var(--space-2)]">
                <Button
                  size="sm"
                  variant="danger"
                  onClick={runMerge}
                  disabled={busy || !mergeTargetId}
                >
                  {busy ? "Merging…" : "Confirm merge"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setOpenPanel(null)}
                  disabled={busy}
                >
                  Cancel
                </Button>
              </div>
            </>
          ) : (
            <p className="m-0 muted">
              No other tags to merge into.
            </p>
          )}
        </div>
      )}

      {error && (
        <p
          className="m-0 text-danger-text text-[length:var(--text-sm)]"
        >
          {error}
        </p>
      )}
    </div>
  );
}
