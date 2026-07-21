"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { postJson } from "@/lib/client-fetch";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { useMutation } from "@/hooks/useMutation";
import {
  ADMIN_BACKFILL_ENDPOINT,
  parseArticleIds,
} from "@/lib/admin/jobs/backfill-ui";

const FEATURES = [
  "difficulty",
  "tags",
  "vocabulary",
  "quiz",
  "translation",
  "speech",
  "grammar",
] as const;

const DEFAULT_SELECTED_FEATURES = ["difficulty", "tags"] as const;
const DEFAULT_BATCH_CAP = 50;

type BackfillMode = "missing" | "rebuild";

type BackfillResponse = {
  dryRun: boolean;
  mode: string;
  scanned: number;
  matched: number;
  cap: number;
  enqueued: number;
  skippedExisting: number;
  cleared: number;
};

function parseTranslateLangs(value: string): string[] {
  return value
    .split(",")
    .map((lang) => lang.trim())
    .filter(Boolean);
}

function parseBatchCap(value: string): number {
  return Number.parseInt(value, 10) || DEFAULT_BATCH_CAP;
}

/**
 * Operator-facing backfill / rebuild trigger (RW-018). Picks feature(s), a mode
 * (fill missing vs force rebuild), an optional filter, a required reason, and an
 * optional dry-run. POSTs to `/api/admin/jobs/backfill` and shows the resulting
 * plan/enqueue summary. The enqueued jobs become visible in the table below.
 */
export default function AdminBackfillForm() {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(DEFAULT_SELECTED_FEATURES),
  );
  const [mode, setMode] = useState<BackfillMode>("missing");
  const [reason, setReason] = useState("");
  const [status, setStatus] = useState("");
  const [category, setCategory] = useState("");
  const [langs, setLangs] = useState("");
  const [articleIdsDraft, setArticleIdsDraft] = useState("");
  const [batchCap, setBatchCap] = useState("50");
  const { busy, error, run } = useMutation("Backfill failed");
  const [result, setResult] = useState<BackfillResponse | null>(null);
  const parsedArticleIds = parseArticleIds(articleIdsDraft);
  const submitDisabled =
    selected.size === 0 || !reason.trim() || parsedArticleIds.error !== null;

  function toggle(feature: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(feature)) next.delete(feature);
      else next.add(feature);
      return next;
    });
  }

  async function submit(dryRun: boolean) {
    setResult(null);
    const translateLangs = parseTranslateLangs(langs);
    const articleIds = parsedArticleIds.articleIds;
    const data = await run(() =>
      postJson<BackfillResponse>(ADMIN_BACKFILL_ENDPOINT, {
        features: Array.from(selected),
        mode,
        reason,
        dryRun,
        batchCap: parseBatchCap(batchCap),
        status: status || undefined,
        category: category || undefined,
        translateLangs: translateLangs.length > 0 ? translateLangs : undefined,
        articleIds: articleIds.length > 0 ? articleIds : undefined,
      }),
    );
    if (!data) return;
    setResult(data);
    if (!data.dryRun && data.enqueued > 0) {
      router.refresh();
    }
  }

  return (
    <div className="stack">
      <fieldset className="flex flex-wrap gap-[var(--space-3)] m-0 p-0 border-0">
        <legend className="sr-only">Features</legend>
        {FEATURES.map((feature) => (
          <label
            key={feature}
            className="inline-flex items-center gap-[var(--space-1)] text-[length:var(--text-sm)]"
          >
            <input
              type="checkbox"
              checked={selected.has(feature)}
              onChange={() => toggle(feature)}
            />
            {feature}
          </label>
        ))}
      </fieldset>

      <div className="flex flex-wrap gap-[var(--space-2)] items-center">
        <label className="text-[length:var(--text-sm)]">
          Mode
          <Select
            value={mode}
            onChange={(e) => setMode(e.target.value as BackfillMode)}
            selectSize="sm"
            className="w-auto ml-[var(--space-1)]"
            aria-label="Backfill mode"
          >
            <option value="missing">Fill missing</option>
            <option value="rebuild">Force rebuild</option>
          </Select>
        </label>
        <Input
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          placeholder="Status filter (optional)"
          inputSize="sm"
          aria-label="Status filter"
          className="w-auto flex-[1_1_140px]"
        />
        <Input
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          placeholder="Category filter (optional)"
          inputSize="sm"
          aria-label="Category filter"
          className="w-auto flex-[1_1_140px]"
        />
        <Input
          value={langs}
          onChange={(e) => setLangs(e.target.value)}
          placeholder="Languages e.g. es,fr"
          inputSize="sm"
          aria-label="Translation languages"
          className="w-auto flex-[1_1_140px]"
        />
        <Input
          value={batchCap}
          onChange={(e) => setBatchCap(e.target.value)}
          placeholder="Batch cap"
          inputSize="sm"
          type="number"
          aria-label="Batch cap"
          className="w-[100px]"
        />
      </div>

      <Input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason (required) — e.g. new quiz prompt v3"
        inputSize="md"
        aria-label="Backfill reason"
      />

      <Field
        label="Target article IDs"
        hint="Optional. Enter comma-separated IDs or one ID per line to limit this run."
        error={parsedArticleIds.error ?? undefined}
      >
        <Textarea
          value={articleIdsDraft}
          onChange={(e) => setArticleIdsDraft(e.target.value)}
          rows={3}
          placeholder="article-id-1, article-id-2"
          disabled={busy}
        />
      </Field>

      <div className="admin-actions-row">
        <Button
          variant="outline"
          size="sm"
          loading={busy}
          disabled={submitDisabled}
          onClick={() => submit(true)}
        >
          Dry run
        </Button>
        <Button
          variant="primary"
          size="sm"
          loading={busy}
          disabled={submitDisabled}
          onClick={() => submit(false)}
        >
          Enqueue backfill
        </Button>
      </div>

      {error && (
        <p className="m-0 text-danger-text text-[length:var(--text-sm)]">
          {error}
        </p>
      )}
      {result && (
        <p className="muted m-0">
          {result.dryRun ? "Dry run: " : ""}
          scanned {result.scanned}, matched {result.matched} work item(s), cap{" "}
          {result.cap}
          {result.dryRun
            ? " — nothing enqueued."
            : ` — enqueued ${result.enqueued}, skipped ${result.skippedExisting} already-active${
                result.cleared > 0 ? `, cleared ${result.cleared} article(s)` : ""
              }.`}
        </p>
      )}
    </div>
  );
}
