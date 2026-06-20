"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
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
      const res = await fetch("/api/admin/articles/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: trimmed }),
      });
      const data = (await res.json()) as {
        status?: string;
        id?: string | null;
        message?: string;
        error?: string;
      };
      if (res.status === 201) {
        setState({ status: "saved", id: data.id! });
        setUrl("");
        router.refresh();
      } else if (res.status === 409) {
        setState({
          status: "duplicate",
          id: data.id ?? null,
          message: data.message ?? "Article already exists.",
        });
      } else {
        setState({
          status: "error",
          message: data.error ?? `Ingest failed (${res.status})`,
        });
      }
    } catch (err) {
      setState({
        status: "error",
        message: err instanceof Error ? err.message : "Ingest failed",
      });
    }
  }

  if (!open) {
    return (
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
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
      <p style={{ margin: 0, fontWeight: 600 }}>Add article from URL</p>
      <p className="muted" style={{ margin: 0, fontSize: "var(--text-sm)" }}>
        Paste a news article URL. It will be scraped and saved as a draft, then
        enriched by the processing worker.
      </p>
      <form onSubmit={handleSubmit} style={{ display: "contents" }}>
        <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
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
        <p style={{ margin: 0 }} className="text-[length:var(--text-sm)]">
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
        <p
          className="text-[length:var(--text-sm)]"
          style={{ margin: 0, color: "var(--warning-text, inherit)" }}
        >
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
        <p
          className="text-danger-text text-[length:var(--text-sm)]"
          style={{ margin: 0 }}
        >
          {state.message}
        </p>
      )}
    </div>
  );
}
