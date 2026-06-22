"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardBody } from "@/components/ui";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { SegmentedControl } from "@/components/ui/SegmentedControl";

type Mode = "url" | "text";

export default function ImportForm() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("url");
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
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

      // A duplicate URL import returns the existing article (no new row, no
      // quota consumed) — let the user know before opening it.
      if (data.duplicate) {
        setNotice("You've already imported this article — opening it now.");
      }

      // Navigate to the reader.
      router.push(`/reader/${data.id}`);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  const modeOptions = [
    { value: "url" as const, label: "Paste URL" },
    { value: "text" as const, label: "Paste Text" },
  ] as const;

  return (
    <Card>
      <CardBody>
        {/* Mode selector */}
        <div className="mb-[var(--space-5)]">
          <SegmentedControl
            label="Import mode"
            value={mode}
            onChange={setMode}
            options={modeOptions}
          />
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
              <Input
                id="import-url"
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com/article"
                required
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
                <Input
                  id="import-title"
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="My article title"
                  maxLength={500}
                />
              </div>
              <div>
                <label
                  htmlFor="import-text"
                  className="block text-sm font-medium text-text mb-1"
                >
                  Article Text
                </label>
                <Textarea
                  id="import-text"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Paste your article text here…"
                  required
                  rows={12}
                  className="resize-y"
                />
                <p className="text-xs text-text-muted mt-1">
                  Separate paragraphs with a blank line.
                </p>
              </div>
            </>
          )}

          {error && (
            <p role="alert" className="text-sm text-danger-text">
              {error}
            </p>
          )}

          {notice && (
            <p role="status" className="text-sm text-text-muted">
              {notice}
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
