"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import ConfirmAction from "@/components/ConfirmAction";
import { useMutation } from "@/hooks/useMutation";
import {
  submitForceRescrape,
  type ForceRescrapeResponse,
} from "@/lib/admin/articles/force-rescrape-actions";

/** Mirrors the route's `reason` bound (`string({ min: 1, max: 500 })`). */
const REASON_MAX_LENGTH = 500;

/** Metadata-only summary of a completed run (never a URL / title / content). */
function resultSummary(result: ForceRescrapeResponse): string {
  if (result.dryRun) {
    const { preview } = result;
    const verdict = preview.wouldActivate
      ? "would activate a new version"
      : `would NOT activate${preview.blockedReason ? ` (${preview.blockedReason})` : ""}`;
    return `Dry run — ${verdict}. ${preview.annotationCount} reader annotation(s); migrator ${
      preview.migratorWired ? "wired" : "not wired"
    }. Nothing was written.`;
  }
  if (result.outcome === "activated") {
    return `Activated — new version ${result.versionId}${
      result.supersededVersionId ? ` (superseded ${result.supersededVersionId})` : ""
    }.`;
  }
  return `Force re-scrape did not activate — ${result.reason}. The current version is retained.`;
}

/**
 * Operator-facing force-rescrape trigger for ONE known public Article (#1142).
 *
 * Surfaces the audited `POST /api/admin/articles/{id}/force-rescrape` backend
 * (#1102/#1103/#1129), modelled on `AdminBackfillForm`: a MANDATORY reason, a
 * "Preview (dry run)" action (metadata-only, writes nothing), and a real
 * "Force re-scrape" action gated behind a `ConfirmAction` because it mutates
 * content. On a real `activated` outcome it `router.refresh()`es so the detail
 * page reloads the new active version. 4xx/409/503 surface the route's `error`
 * string (the 409 "already in progress" and 503 "disabled" messages read
 * clearly) in an inline `role="alert"` region. Only ids / counts / booleans are
 * ever shown — never a URL or article content.
 */
export default function AdminForceRescrapePanel({ articleId }: { articleId: string }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<ForceRescrapeResponse | null>(null);
  const { busy, error, run } = useMutation("Force re-scrape failed");
  const submitDisabled = !reason.trim();

  async function submit(dryRun: boolean) {
    setResult(null);
    const data = await run(() => submitForceRescrape(articleId, reason, dryRun));
    if (!data) return;
    setResult(data);
    if (!data.dryRun && data.outcome === "activated") {
      router.refresh();
    }
  }

  return (
    <div className="stack">
      <Input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        maxLength={REASON_MAX_LENGTH}
        placeholder="Reason (required) — operator justification, e.g. stale extraction v2"
        inputSize="md"
        aria-label="Force re-scrape reason"
      />

      <div className="admin-actions-row">
        <Button
          variant="outline"
          size="sm"
          loading={busy}
          disabled={submitDisabled}
          onClick={() => submit(true)}
        >
          Preview (dry run)
        </Button>
        <ConfirmAction
          triggerLabel="Force re-scrape"
          triggerVariant="secondary"
          confirmVariant="primary"
          confirmLabel="Confirm force re-scrape"
          confirmMessage="Fetch and validate a fresh copy of this article and, if every gate passes, ATOMICALLY replace the live version? Reader progress and highlights are preserved; the current version is retained on any failure."
          onConfirm={() => submit(false)}
          loading={busy}
          disabled={submitDisabled}
        />
      </div>

      {error && (
        <p className="m-0 text-danger-text text-[length:var(--text-sm)]" role="alert">
          {error}
        </p>
      )}
      {result && <p className="muted m-0">{resultSummary(result)}</p>}
    </div>
  );
}
