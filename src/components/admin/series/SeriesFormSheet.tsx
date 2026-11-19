"use client";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Select } from "@/components/ui/Select";
import { Switch } from "@/components/ui/Switch";
import { Field } from "@/components/ui/Field";
import { Sheet } from "@/components/ui/Sheet";
import { FormActions } from "@/components/ui/FormActions";
import { Stack } from "@/components/ui/Stack";
import { Notice } from "@/components/ui/Notice";

export type SeriesStatus = "draft" | "active" | "archived";

/** Editable series fields; blank strings mean "not set". */
export interface SeriesForm {
  slug: string;
  title: string;
  description: string;
  topic: string;
  targetLevelMin: string;
  targetLevelMax: string;
  public: boolean;
  status: SeriesStatus;
}

export const EMPTY_SERIES_FORM: SeriesForm = {
  slug: "",
  title: "",
  description: "",
  topic: "",
  targetLevelMin: "",
  targetLevelMax: "",
  public: false,
  status: "draft",
};

const MODE_COPY = {
  create: {
    heading: "New series",
    submit: "Create series",
    titlePlaceholder: "e.g. Advanced Business Reading",
    slugPlaceholder: "e.g. advanced-business-reading",
    slugHint: "URL-safe identifier, auto-generated from title",
  },
  edit: {
    heading: "Edit series",
    submit: "Save changes",
    titlePlaceholder: "Series title",
    slugPlaceholder: "series-slug",
    slugHint: "URL-safe identifier",
  },
} as const;

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Create/edit drawer for a reading series. In `create` mode the slug follows
 * the title until the admin edits it, and new series may only start as draft
 * or active; `edit` mode also offers archived.
 */
export function SeriesFormSheet({
  mode,
  open,
  label,
  form,
  onChange,
  onClose,
  onSubmit,
  busy,
  error,
}: {
  mode: "create" | "edit";
  open: boolean;
  label: string;
  form: SeriesForm;
  onChange: (next: SeriesForm) => void;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
  busy: boolean;
  error: string | null;
}) {
  const copy = MODE_COPY[mode];

  function set<K extends keyof SeriesForm>(key: K, value: SeriesForm[K]) {
    onChange({ ...form, [key]: value });
  }

  function setTitle(title: string) {
    const followSlug = mode === "create" && (!form.slug || form.slug === slugify(form.title));
    onChange({ ...form, title, ...(followSlug ? { slug: slugify(title) } : {}) });
  }

  return (
    <Sheet open={open} onClose={onClose} side="right" label={label}>
      <div className="flex items-center justify-between border-b border-border px-[var(--space-5)] py-[var(--space-4)]">
        <h2 className="m-0 text-[length:var(--type-section-title)] font-semibold text-text">{copy.heading}</h2>
        <Button variant="outline" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>

      <form
        onSubmit={onSubmit}
        className="flex flex-col gap-[var(--space-4)] overflow-y-auto px-[var(--space-5)] py-[var(--space-4)]"
        noValidate
      >
        <Stack gap="4">
          <Field label="Title" required>
            <Input
              value={form.title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={copy.titlePlaceholder}
              inputSize="sm"
              required
              aria-required="true"
              autoFocus
            />
          </Field>

          <Field label="Slug" required hint={copy.slugHint}>
            <Input
              value={form.slug}
              onChange={(e) => set("slug", e.target.value)}
              placeholder={copy.slugPlaceholder}
              inputSize="sm"
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
              inputSize="sm"
            />
          </Field>

          <div className="grid grid-cols-2 gap-[var(--space-3)]">
            <Field label="Min level">
              <Input
                value={form.targetLevelMin}
                onChange={(e) => set("targetLevelMin", e.target.value)}
                placeholder="e.g. B1"
                inputSize="sm"
              />
            </Field>
            <Field label="Max level">
              <Input
                value={form.targetLevelMax}
                onChange={(e) => set("targetLevelMax", e.target.value)}
                placeholder="e.g. C2"
                inputSize="sm"
              />
            </Field>
          </div>

          <Field label="Status">
            <Select
              value={form.status}
              onChange={(e) => set("status", e.target.value as SeriesStatus)}
              selectSize="sm"
            >
              <option value="draft">Draft</option>
              <option value="active">Active</option>
              {mode === "edit" && <option value="archived">Archived</option>}
            </Select>
          </Field>

          <div className="flex items-center gap-[var(--space-3)]">
            <Switch checked={form.public} onCheckedChange={(v) => set("public", v)} aria-label="Public series" />
            <span className="text-[length:var(--text-sm)] text-text">Visible to all learners</span>
          </div>
        </Stack>

        {error && <Notice tone="danger">{error}</Notice>}

        <FormActions>
          <Button
            type="submit"
            variant="primary"
            size="sm"
            loading={busy}
            disabled={!form.title.trim() || !form.slug.trim()}
          >
            {copy.submit}
          </Button>
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
        </FormActions>
      </form>
    </Sheet>
  );
}
