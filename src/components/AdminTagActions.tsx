"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ConfirmAction from "@/components/ConfirmAction";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";

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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Rename state
  const [newName, setNewName] = useState(tagName);

  // Merge state
  const [tagOptions, setTagOptions] = useState<TagOption[] | null>(null);
  const [loadingTags, setLoadingTags] = useState(false);
  const [mergeTargetId, setMergeTargetId] = useState("");

  function openRename() {
    setNewName(tagName);
    setError(null);
    setOpenPanel(openPanel === "rename" ? null : "rename");
  }

  async function openMerge() {
    setError(null);
    if (openPanel === "merge") {
      setOpenPanel(null);
      return;
    }
    setOpenPanel("merge");
    if (!tagOptions) {
      setLoadingTags(true);
      try {
        const res = await fetch("/api/admin/tags");
        const data = (await res.json()) as TagOption[];
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
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/tags/${tagId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(data?.error ?? `Rename failed (${res.status})`);
      }
      setOpenPanel(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Rename failed");
    } finally {
      setBusy(false);
    }
  }

  async function runMerge() {
    if (!mergeTargetId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/tags/${tagId}/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetId: mergeTargetId }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(data?.error ?? `Merge failed (${res.status})`);
      }
      setOpenPanel(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Merge failed");
    } finally {
      setBusy(false);
    }
  }

  async function runDelete() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/tags/${tagId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(data?.error ?? `Delete failed (${res.status})`);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBusy(false);
    }
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
          triggerVariant="danger"
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
            setError(null);
            setOpenPanel(v ? "delete" : null);
          }}
        />
      </div>

      {openPanel === "rename" && (
        <div className="admin-confirm">
          <p style={{ margin: 0 }}>New name for &quot;{tagName}&quot;:</p>
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
          <div style={{ display: "flex", gap: "var(--space-2)" }}>
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
          <p style={{ margin: 0 }}>
            Merge &quot;{tagName}&quot; into another tag:
          </p>
          {loadingTags ? (
            <p className="muted" style={{ margin: 0 }}>
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
              <p
                className="muted"
                style={{ margin: 0, fontSize: "var(--text-sm)" }}
              >
                All articles tagged &quot;{tagName}&quot; will gain &quot;
                {mergeTarget?.name ?? "…"}&quot;. The original tag will be
                deleted.
              </p>
              <div style={{ display: "flex", gap: "var(--space-2)" }}>
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
            <p className="muted" style={{ margin: 0 }}>
              No other tags to merge into.
            </p>
          )}
        </div>
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
