"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { postJson } from "@/lib/client-fetch";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";

const FEATURES = [
  "difficulty",
  "tags",
  "vocabulary",
  "quiz",
  "translation",
  "speech",
  "grammar",
] as const;

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

/**
 * Operator-facing backfill / rebuild trigger (RW-018). Picks feature(s), a mode
 * (fill missing vs force rebuild), an optional filter, a required reason, and an
 * optional dry-run. POSTs to `/api/admin/jobs/backfill` and shows the resulting
 * plan/enqueue summary. The enqueued jobs become visible in the table below.
 */
export default function AdminBackfillForm() {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set(["difficulty", "tags"]));
  const [mode, setMode] = useState<"missing" | "rebuild">("missing");
  const [reason, setReason] = useState("");
  const [status, setStatus] = useState("");
  const [category, setCategory] = useState("");
  const [langs, setLangs] = useState("");
  const [batchCap, setBatchCap] = useState("50");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BackfillResponse | null>(null);

  function toggle(feature: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(feature)) next.delete(feature);
      else next.add(feature);
      return next;
    });
  }

  async function submit(dryRun: boolean) {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const translateLangs = langs
          .split(",")
          .map((l) => l.trim())
          .filter(Boolean);
      const data = await postJson<BackfillResponse>("/api/admin/jobs/backfill", {
          features: Array.from(selected),
          mode,
          reason,
          dryRun,
          batchCap: Number.parseInt(batchCap, 10) || 50,
          status: status || undefined,
          category: category || undefined,
          translateLangs: translateLangs.length > 0 ? translateLangs : undefined,
      });
      setResult(data);
      if (!data.dryRun && data.enqueued > 0) {
          router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Backfill failed");
    } finally {
      setBusy(false);
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
            onChange={(e) => setMode(e.target.value as "missing" | "rebuild")}
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

      <div className="admin-actions-row">
        <Button
          variant="outline"
          size="sm"
          loading={busy}
          disabled={selected.size === 0 || !reason.trim()}
          onClick={() => submit(true)}
        >
          Dry run
        </Button>
        <Button
          variant="primary"
          size="sm"
          loading={busy}
          disabled={selected.size === 0 || !reason.trim()}
          onClick={() => submit(false)}
        >
          Enqueue backfill
        </Button>
      </div>

      {error && (
        <p className="text-danger-text text-[length:var(--text-sm)]" style={{ margin: 0 }}>
          {error}
        </p>
      )}
      {result && (
        <p className="muted" style={{ margin: 0 }}>
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
