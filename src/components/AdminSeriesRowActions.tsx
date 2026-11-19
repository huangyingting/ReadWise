"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { patchJson, deleteJson } from "@/lib/client-fetch";
import { useMutation } from "@/hooks/useMutation";
import ConfirmAction from "@/components/ConfirmAction";
import AdminSeriesArticleManager from "@/components/admin/series/AdminSeriesArticleManager";
import { Button } from "@/components/ui/Button";
import { SeriesFormSheet, type SeriesForm, type SeriesStatus } from "@/components/admin/series/SeriesFormSheet";

export interface SeriesRowData {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  topic: string | null;
  targetLevelMin: string | null;
  targetLevelMax: string | null;
  status: SeriesStatus;
  public: boolean;
  articleCount: number;
}

function toEditForm(series: SeriesRowData): SeriesForm {
  return {
    slug: series.slug,
    title: series.title,
    description: series.description ?? "",
    topic: series.topic ?? "",
    targetLevelMin: series.targetLevelMin ?? "",
    targetLevelMax: series.targetLevelMax ?? "",
    public: series.public,
    status: series.status,
  };
}

type ActivePanel = "edit" | "activate" | "archive" | "delete" | null;

export default function AdminSeriesRowActions({ series }: { series: SeriesRowData }) {
  const router = useRouter();
  const { busy, error, run, clearError } = useMutation();
  const [activePanel, setActivePanel] = useState<ActivePanel>(null);
  const [form, setForm] = useState<SeriesForm>(() => toEditForm(series));

  function openEdit() {
    setForm(toEditForm(series));
    clearError();
    setActivePanel("edit");
  }

  async function afterMutation<T>(result: T | undefined, onSuccess?: () => void) {
    if (result === undefined) {
      throw new Error("Mutation failed");
    }
    onSuccess?.();
    router.refresh();
    return result;
  }

  async function handleEditSubmit(e: React.FormEvent) {
    e.preventDefault();
    const result = await run(
      async () => {
        const body: Record<string, unknown> = {
          slug: form.slug.trim(),
          title: form.title.trim(),
          public: form.public,
          status: form.status,
          description: form.description.trim() || null,
          topic: form.topic.trim() || null,
          targetLevelMin: form.targetLevelMin.trim() || null,
          targetLevelMax: form.targetLevelMax.trim() || null,
        };
        return patchJson(`/api/admin/series/${series.id}`, body);
      },
      { fallbackMessage: "Failed to update series" },
    );
    if (result !== undefined) {
      await afterMutation(result, () => setActivePanel(null));
    }
  }

  async function handleActivate() {
    const result = await run(
      () => patchJson(`/api/admin/series/${series.id}`, { status: "active" }),
      { fallbackMessage: "Failed to activate series" },
    );
    await afterMutation(result, () => setActivePanel(null));
  }

  async function handleArchive() {
    const result = await run(
      () => patchJson(`/api/admin/series/${series.id}`, { status: "archived" }),
      { fallbackMessage: "Failed to archive series" },
    );
    await afterMutation(result, () => setActivePanel(null));
  }

  async function handleDelete() {
    const result = await run(
      () => deleteJson(`/api/admin/series/${series.id}`),
      { fallbackMessage: "Failed to delete series" },
    );
    await afterMutation(result);
  }

  const canActivate = series.status === "draft";
  const canArchive = series.status === "active";
  const canDelete = series.status !== "active" || series.articleCount === 0;

  return (
    <div className="admin-actions">
      <div className="admin-actions-row">
        <Button
          size="sm"
          variant="outline"
          onClick={openEdit}
          disabled={busy}
        >
          Edit
        </Button>

        <AdminSeriesArticleManager seriesId={series.id} title={series.title} />

        {canActivate && (
          <ConfirmAction
            triggerLabel="Activate"
            triggerVariant="secondary"
            confirmVariant="primary"
            confirmLabel="Confirm activate"
            confirmMessage={
              <>
                Activate &quot;{series.title}&quot;? It will become visible to
                learners if marked public.
              </>
            }
            onConfirm={handleActivate}
            loading={busy && activePanel === "activate"}
            disabled={busy}
            open={activePanel === "activate"}
            onOpenChange={(v) => {
              clearError();
              setActivePanel(v ? "activate" : null);
            }}
          />
        )}

        {canArchive && (
          <ConfirmAction
            triggerLabel="Archive"
            triggerVariant="secondary"
            confirmVariant="danger"
            confirmLabel="Confirm archive"
            confirmMessage={
              <>
                Archive &quot;{series.title}&quot;? It will be hidden from
                learners. This cannot be reversed.
              </>
            }
            onConfirm={handleArchive}
            loading={busy && activePanel === "archive"}
            disabled={busy}
            open={activePanel === "archive"}
            onOpenChange={(v) => {
              clearError();
              setActivePanel(v ? "archive" : null);
            }}
          />
        )}

        <ConfirmAction
          triggerLabel="Delete"
          triggerVariant="danger-ghost"
          confirmVariant="danger"
          confirmLabel="Confirm delete"
          confirmMessage={
            <>
              Delete &quot;{series.title}&quot;? This cannot be undone.
              {series.status === "active"
                ? " Active series with enrollments cannot be deleted."
                : null}
            </>
          }
          onConfirm={handleDelete}
          loading={busy && activePanel === "delete"}
          disabled={busy || (series.status === "active" && series.articleCount > 0)}
          disabledTitle={
            series.status === "active" && series.articleCount > 0
              ? "Archive first to delete an active series"
              : undefined
          }
          open={activePanel === "delete"}
          onOpenChange={(v) => {
            clearError();
            setActivePanel(v ? "delete" : null);
          }}
        />
      </div>

      {error && activePanel !== "edit" && (
        <p className="m-0 text-[length:var(--text-sm)] text-danger-text" role="alert">
          {error}
        </p>
      )}

      <SeriesFormSheet
        mode="edit"
        open={activePanel === "edit"}
        label={`Edit series: ${series.title}`}
        form={form}
        onChange={setForm}
        onClose={() => setActivePanel(null)}
        onSubmit={handleEditSubmit}
        busy={busy}
        error={error}
      />
    </div>
  );
}
