"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { patchJson, deleteJson } from "@/lib/client-fetch";
import { useMutation } from "@/hooks/useMutation";
import ConfirmAction from "@/components/ConfirmAction";
import AdminSeriesArticleManager from "@/components/admin/series/AdminSeriesArticleManager";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Select } from "@/components/ui/Select";
import { Switch } from "@/components/ui/Switch";
import { Field } from "@/components/ui/Field";
import { Sheet } from "@/components/ui/Sheet";
import { FormActions } from "@/components/ui/FormActions";
import { Stack } from "@/components/ui/Stack";

type SeriesStatus = "draft" | "active" | "archived";

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

interface EditForm {
  slug: string;
  title: string;
  description: string;
  topic: string;
  targetLevelMin: string;
  targetLevelMax: string;
  public: boolean;
  status: SeriesStatus;
}

function toEditForm(series: SeriesRowData): EditForm {
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
  const [form, setForm] = useState<EditForm>(() => toEditForm(series));

  function openEdit() {
    setForm(toEditForm(series));
    clearError();
    setActivePanel("edit");
  }

  function set<K extends keyof EditForm>(key: K, value: EditForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
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

      <Sheet
        open={activePanel === "edit"}
        onClose={() => setActivePanel(null)}
        side="right"
        label={`Edit series: ${series.title}`}
      >
        <div className="flex items-center justify-between border-b border-border px-[var(--space-5)] py-[var(--space-4)]">
          <h2 className="m-0 text-[length:var(--text-lg)] font-semibold text-text">
            Edit series
          </h2>
          <Button variant="outline" size="sm" onClick={() => setActivePanel(null)}>
            Close
          </Button>
        </div>

        <form
          onSubmit={handleEditSubmit}
          className="flex flex-col gap-[var(--space-4)] overflow-y-auto px-[var(--space-5)] py-[var(--space-4)]"
          noValidate
        >
          <Stack gap="4">
            <Field label="Title" required>
              <Input
                value={form.title}
                onChange={(e) => set("title", e.target.value)}
                placeholder="Series title"
                inputSize="md"
                required
                aria-required="true"
                autoFocus
              />
            </Field>

            <Field label="Slug" required hint="URL-safe identifier">
              <Input
                value={form.slug}
                onChange={(e) => set("slug", e.target.value)}
                placeholder="series-slug"
                inputSize="md"
                required
                aria-required="true"
              />
            </Field>

            <Field label="Description">
              <Textarea
                value={form.description}
                onChange={(e) => set("description", e.target.value)}
                placeholder="Short description for learners…"
                rows={3}
              />
            </Field>

            <Field label="Topic">
              <Input
                value={form.topic}
                onChange={(e) => set("topic", e.target.value)}
                placeholder="e.g. Business, Science"
                inputSize="md"
              />
            </Field>

            <div className="grid grid-cols-2 gap-[var(--space-3)]">
              <Field label="Min level">
                <Input
                  value={form.targetLevelMin}
                  onChange={(e) => set("targetLevelMin", e.target.value)}
                  placeholder="e.g. B1"
                  inputSize="md"
                />
              </Field>
              <Field label="Max level">
                <Input
                  value={form.targetLevelMax}
                  onChange={(e) => set("targetLevelMax", e.target.value)}
                  placeholder="e.g. C2"
                  inputSize="md"
                />
              </Field>
            </div>

            <Field label="Status">
              <Select
                value={form.status}
                onChange={(e) => set("status", e.target.value as SeriesStatus)}
                selectSize="md"
              >
                <option value="draft">Draft</option>
                <option value="active">Active</option>
                <option value="archived">Archived</option>
              </Select>
            </Field>

            <div className="flex items-center gap-[var(--space-3)]">
              <Switch
                checked={form.public}
                onCheckedChange={(v) => set("public", v)}
                aria-label="Public series"
              />
              <span className="text-[length:var(--text-sm)] text-text">
                Visible to all learners
              </span>
            </div>
          </Stack>

          {error && (
            <p className="m-0 text-[length:var(--text-sm)] text-danger-text" role="alert">
              {error}
            </p>
          )}

          <FormActions>
            <Button
              type="submit"
              variant="primary"
              size="md"
              loading={busy}
              disabled={!form.title.trim() || !form.slug.trim()}
            >
              Save changes
            </Button>
            <Button
              type="button"
              variant="outline"
              size="md"
              disabled={busy}
              onClick={() => setActivePanel(null)}
            >
              Cancel
            </Button>
          </FormActions>
        </form>
      </Sheet>
    </div>
  );
}
