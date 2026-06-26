"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ApiResponseError, requestJson } from "@/lib/client-fetch";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

type IngestState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "saved"; id: string }
  | { status: "duplicate"; id: string | null; message: string }
  | { status: "error"; message: string };

export default function AdminArticleIngest() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [state, setState] = useState<IngestState>({ status: "idle" });
  const [open, setOpen] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) return;
    setState({ status: "loading" });
    try {
      const data = await requestJson<{
        status?: string;
        id?: string | null;
        message?: string;
        error?: string;
      }>("/api/admin/articles/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: trimmed }),
      });
      setState({ status: "saved", id: data.id! });
      setUrl("");
      router.refresh();
    } catch (err) {
      if (err instanceof ApiResponseError && err.status === 409) {
        const duplicate = (err as ApiResponseError & { cause?: unknown }).cause;
        const data =
          duplicate && typeof duplicate === "object"
            ? (duplicate as { id?: string | null; message?: string })
            : null;
        setState({
          status: "duplicate",
          id: data?.id ?? null,
          message: data?.message ?? "Article already exists.",
        });
        return;
      }
      setState({
        status: "error",
        message: err instanceof Error ? err.message : "Ingest failed",
      });
    }
  }

  if (!open) {
    return (
      <div className="flex justify-end">
        <Button
          variant="primary"
          size="sm"
          onClick={() => {
            setState({ status: "idle" });
            setUrl("");
            setOpen(true);
          }}
        >
          + Add article
        </Button>
      </div>
    );
  }

  return (
    <div className="admin-confirm">
      <p className="m-0 font-semibold">Add article from URL</p>
      <p className="muted m-0 text-[length:var(--text-sm)]">
        Paste a news article URL. It will be scraped and saved as a draft, then
        enriched by the processing worker.
      </p>
      <form onSubmit={handleSubmit} className="contents">
        <div className="flex gap-[var(--space-2)] flex-wrap">
          <Input
            type="url"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              if (state.status !== "idle" && state.status !== "loading") {
                setState({ status: "idle" });
              }
            }}
            placeholder="https://example.com/article/…"
            inputSize="sm"
            className="flex-[1_1_320px]"
            aria-label="Article URL"
            disabled={state.status === "loading"}
            autoFocus
          />
          <Button
            type="submit"
            variant="primary"
            size="sm"
            disabled={state.status === "loading" || !url.trim()}
          >
            {state.status === "loading" ? "Scraping…" : "Ingest"}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setOpen(false)}
            disabled={state.status === "loading"}
          >
            Cancel
          </Button>
        </div>
      </form>

      {state.status === "saved" && (
        <p className="m-0 text-[length:var(--text-sm)]">
          ✓ Saved as draft.{" "}
          <Link
            href={`/admin/articles/${state.id}`}
            className="text-primary-text hover:underline"
          >
            View draft →
          </Link>
        </p>
      )}
      {state.status === "duplicate" && (
        <p className="m-0 text-[length:var(--text-sm)] text-warning-text">
          {state.message}
          {state.id && (
            <>
              {" "}
              <Link
                href={`/admin/articles/${state.id}`}
                className="text-primary-text hover:underline"
              >
                View existing →
              </Link>
            </>
          )}
        </p>
      )}
      {state.status === "error" && (
        <p className="m-0 text-danger-text text-[length:var(--text-sm)]">
          {state.message}
        </p>
      )}
    </div>
  );
}
