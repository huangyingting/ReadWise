"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardBody } from "@/components/ui";
import { Button } from "@/components/ui/Button";

type Mode = "url" | "text";

export default function ImportForm() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("url");
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const body =
        mode === "url"
          ? { url: url.trim() }
          : { title: title.trim() || undefined, text };

      const res = await fetch("/api/articles/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data?.error ?? "Import failed. Please try again.");
        return;
      }

      // Navigate to the reader.
      router.push(`/reader/${data.id}`);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardBody>
        {/* Mode tabs */}
        <div className="flex gap-[var(--space-2)] mb-[var(--space-5)]">
          <button
            type="button"
            onClick={() => setMode("url")}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              mode === "url"
                ? "bg-accent text-white"
                : "bg-surface-raised text-text-muted hover:text-text"
            }`}
          >
            Paste URL
          </button>
          <button
            type="button"
            onClick={() => setMode("text")}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              mode === "text"
                ? "bg-accent text-white"
                : "bg-surface-raised text-text-muted hover:text-text"
            }`}
          >
            Paste Text
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-[var(--space-4)]">
          {mode === "url" ? (
            <div>
              <label
                htmlFor="import-url"
                className="block text-sm font-medium text-text mb-1"
              >
                Article URL
              </label>
              <input
                id="import-url"
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com/article"
                required
                className="admin-input w-full"
              />
              <p className="text-xs text-text-muted mt-1">
                Paste a link to any publicly accessible article.
              </p>
            </div>
          ) : (
            <>
              <div>
                <label
                  htmlFor="import-title"
                  className="block text-sm font-medium text-text mb-1"
                >
                  Title{" "}
                  <span className="text-text-muted font-normal">(optional)</span>
                </label>
                <input
                  id="import-title"
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="My article title"
                  maxLength={500}
                  className="admin-input w-full"
                />
              </div>
              <div>
                <label
                  htmlFor="import-text"
                  className="block text-sm font-medium text-text mb-1"
                >
                  Article Text
                </label>
                <textarea
                  id="import-text"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Paste your article text here…"
                  required
                  rows={12}
                  className="admin-input w-full resize-y"
                />
                <p className="text-xs text-text-muted mt-1">
                  Separate paragraphs with a blank line.
                </p>
              </div>
            </>
          )}

          {error && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {error}
            </p>
          )}

          <Button
            type="submit"
            variant="primary"
            loading={loading}
            className="self-start"
          >
            Import Article
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}
