"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { t } from "@/lib/i18n";

interface SeriesEnrollButtonProps {
  seriesId: string;
  enrolled: boolean;
}

/**
 * Enroll / unenroll control for a curated reading series (#813). Calls the
 * access-checked `POST`/`DELETE /api/series/[id]/enroll` endpoints and refreshes
 * the server component so the enrollment state re-renders. Carries no article
 * content — only the series id.
 */
export function SeriesEnrollButton({ seriesId, enrolled }: SeriesEnrollButtonProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);

  async function toggle() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/series/${encodeURIComponent(seriesId)}/enroll`, {
        method: enrolled ? "DELETE" : "POST",
      });
      if (res.ok) {
        startTransition(() => router.refresh());
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      type="button"
      variant={enrolled ? "secondary" : "primary"}
      onClick={toggle}
      disabled={busy || pending}
    >
      {enrolled ? t("series.action.unenroll") : t("series.action.enroll")}
    </Button>
  );
}
