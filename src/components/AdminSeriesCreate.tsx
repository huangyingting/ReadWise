"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { postJson } from "@/lib/client-fetch";
import { useMutation } from "@/hooks/useMutation";
import { Button } from "@/components/ui/Button";
import {
  EMPTY_SERIES_FORM,
  SeriesFormSheet,
  type SeriesForm,
} from "@/components/admin/series/SeriesFormSheet";

export default function AdminSeriesCreate() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<SeriesForm>(EMPTY_SERIES_FORM);
  const { busy, error, run } = useMutation();

  function openSheet() {
    setForm(EMPTY_SERIES_FORM);
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
        if (form.description.trim()) body.description = form.description.trim();
        if (form.topic.trim()) body.topic = form.topic.trim();
        if (form.targetLevelMin.trim()) body.targetLevelMin = form.targetLevelMin.trim();
        if (form.targetLevelMax.trim()) body.targetLevelMax = form.targetLevelMax.trim();
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

      <SeriesFormSheet
        mode="create"
        open={open}
        label="Create series"
        form={form}
        onChange={setForm}
        onClose={() => setOpen(false)}
        onSubmit={handleSubmit}
        busy={busy}
        error={error}
      />
    </>
  );
}
