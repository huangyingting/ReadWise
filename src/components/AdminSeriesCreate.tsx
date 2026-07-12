"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { postJson } from "@/lib/client-fetch";
import { useMutation } from "@/hooks/useMutation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Select } from "@/components/ui/Select";
import { Switch } from "@/components/ui/Switch";
import { Field } from "@/components/ui/Field";
import { Sheet } from "@/components/ui/Sheet";
import { FormActions } from "@/components/ui/FormActions";
import { Stack } from "@/components/ui/Stack";

type CreatePayload = {
  slug: string;
  title: string;
  description?: string;
  topic?: string;
  targetLevelMin?: string;
  targetLevelMax?: string;
  public: boolean;
  status: "draft" | "active";
};

const EMPTY: CreatePayload = {
  slug: "",
  title: "",
  description: "",
  topic: "",
  targetLevelMin: "",
  targetLevelMax: "",
  public: false,
  status: "draft",
};

export default function AdminSeriesCreate() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<CreatePayload>(EMPTY);
  const { busy, error, run } = useMutation();

  function set<K extends keyof CreatePayload>(key: K, value: CreatePayload[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function openSheet() {
    setForm(EMPTY);
    setOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const result = await run(
      async () => {
        const body: Record<string, unknown> = {
          slug: form.slug.trim(),
          title: form.title.trim(),
          public: form.public,
          status: form.status,
        };
        if (form.description?.trim()) body.description = form.description.trim();
        if (form.topic?.trim()) body.topic = form.topic.trim();
        if (form.targetLevelMin?.trim()) body.targetLevelMin = form.targetLevelMin.trim();
        if (form.targetLevelMax?.trim()) body.targetLevelMax = form.targetLevelMax.trim();
        return postJson("/api/admin/series", body);
      },
      {
        fallbackMessage: "Failed to create series",
        refreshOnSuccess: true,
        onSuccess: () => setOpen(false),
      },
    );
    if (result !== undefined) {
      router.refresh();
    }
  }

  return (
    <>
      <Button variant="primary" size="sm" onClick={openSheet}>
        New series
      </Button>

      <Sheet open={open} onClose={() => setOpen(false)} side="right" label="Create series">
        <div className="flex items-center justify-between border-b border-border px-[var(--space-5)] py-[var(--space-4)]">
          <h2 className="m-0 text-[length:var(--text-lg)] font-semibold text-text">
            New series
          </h2>
          <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
            Close
          </Button>
        </div>

        <form
          onSubmit={handleSubmit}
          className="flex flex-col gap-[var(--space-4)] overflow-y-auto px-[var(--space-5)] py-[var(--space-4)]"
          noValidate
        >
          <Stack gap="4">
            <Field label="Title" required>
              <Input
                value={form.title}
                onChange={(e) => {
                  const title = e.target.value;
                  set("title", title);
                  if (!form.slug || form.slug === slugify(form.title)) {
                    set("slug", slugify(title));
                  }
                }}
                placeholder="e.g. Advanced Business Reading"
                inputSize="md"
                required
                aria-required="true"
                autoFocus
              />
            </Field>

            <Field label="Slug" required hint="URL-safe identifier, auto-generated from title">
              <Input
                value={form.slug}
                onChange={(e) => set("slug", e.target.value)}
                placeholder="e.g. advanced-business-reading"
                inputSize="md"
                required
                aria-required="true"
              />
            </Field>

            <Field label="Description">
              <Textarea
                value={form.description ?? ""}
                onChange={(e) => set("description", e.target.value)}
                placeholder="Short description for learners…"
                rows={3}
              />
            </Field>

            <Field label="Topic">
              <Input
                value={form.topic ?? ""}
                onChange={(e) => set("topic", e.target.value)}
                placeholder="e.g. Business, Science"
                inputSize="md"
              />
            </Field>

            <div className="grid grid-cols-2 gap-[var(--space-3)]">
              <Field label="Min level">
                <Input
                  value={form.targetLevelMin ?? ""}
                  onChange={(e) => set("targetLevelMin", e.target.value)}
                  placeholder="e.g. B1"
                  inputSize="md"
                />
              </Field>
              <Field label="Max level">
                <Input
                  value={form.targetLevelMax ?? ""}
                  onChange={(e) => set("targetLevelMax", e.target.value)}
                  placeholder="e.g. C2"
                  inputSize="md"
                />
              </Field>
            </div>

            <Field label="Status">
              <Select
                value={form.status}
                onChange={(e) =>
                  set("status", e.target.value as "draft" | "active")
                }
                selectSize="md"
              >
                <option value="draft">Draft</option>
                <option value="active">Active</option>
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
              Create series
            </Button>
            <Button
              type="button"
              variant="outline"
              size="md"
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
          </FormActions>
        </form>
      </Sheet>
    </>
  );
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
