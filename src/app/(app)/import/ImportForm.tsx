"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiResponseError, postJson } from "@/lib/client-fetch";
import { Card, CardBody } from "@/components/ui";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { SegmentedControl } from "@/components/ui/SegmentedControl";

/** Must match the server-side MIN_IMPORT_WORDS constant in the import route. */
const MIN_IMPORT_WORDS = 50;

type Mode = "url" | "text";

function countWords(t: string): number {
  return t.trim() ? t.trim().split(/\s+/).filter(Boolean).length : 0;
}

export default function ImportForm() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("url");
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const feedbackRef = useRef<HTMLDivElement>(null);

  const textWordCount = countWords(text);
  const textBelowMin = mode === "text" && text.trim().length > 0 && textWordCount < MIN_IMPORT_WORDS;
  const submitDisabled =
    loading ||
    (mode === "url" && !url.trim()) ||
    (mode === "text" && (text.trim().length === 0 || textWordCount < MIN_IMPORT_WORDS));

  // Scroll feedback into view whenever error or notice changes.
  useEffect(() => {
    if ((error || notice) && feedbackRef.current) {
      feedbackRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [error, notice]);

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

      const data = await postJson<{ duplicate?: boolean; id: string }>(
        "/api/articles/import",
        body,
      );

      if (data.duplicate) {
        // Re-import of an existing article — let the user know before opening.
        setNotice("You've already imported this article — opening it now.");
        setTimeout(() => router.push(`/reader/${data.id}`), 1500);
      } else if (mode === "text") {
        // Text paste — show a brief confirmation before navigating.
        setNotice("Article imported successfully! Opening reader…");
        setTimeout(() => router.push(`/reader/${data.id}`), 1200);
      } else {
        router.push(`/reader/${data.id}`);
      }
    } catch (err) {
      if (err instanceof ApiResponseError) {
        setError(err.message || "Import failed. Please try again.");
      } else {
        setError("Network error. Please try again.");
      }
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
                className="mb-[var(--space-1)] block text-[length:var(--text-sm)] font-medium text-text"
              >
                Article URL
              </label>
              <Input
                id="import-url"
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com/article"
              />
              <p className="mt-[var(--space-1)] text-[length:var(--text-xs)] text-text-muted">
                Paste a link to any publicly accessible article.
              </p>
            </div>
          ) : (
            <>
              <div>
                <label
                  htmlFor="import-title"
                    className="mb-[var(--space-1)] block text-[length:var(--text-sm)] font-medium text-text"
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
                  className="mb-[var(--space-1)] block text-[length:var(--text-sm)] font-medium text-text"
                >
                  Article Text
                </label>
                <Textarea
                  id="import-text"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Paste your article text here…"
                  rows={12}
                  className="resize-y"
                />
                <p className="mt-[var(--space-1)] text-[length:var(--text-xs)] text-text-muted">
                  {textWordCount > 0 ? (
                    <>
                      <span className={textBelowMin ? "text-danger-text" : undefined}>
                        {textWordCount} word{textWordCount !== 1 ? "s" : ""}
                      </span>
                      {textBelowMin && ` — minimum ${MIN_IMPORT_WORDS} required`}
                    </>
                  ) : (
                    <>Minimum {MIN_IMPORT_WORDS} words. Separate paragraphs with a blank line.</>
                  )}
                </p>
              </div>
            </>
          )}

          <div ref={feedbackRef}>
            {error && (
              <p role="alert" className="text-[length:var(--text-sm)] text-danger-text">
                {error}
              </p>
            )}
            {notice && (
              <p role="status" className="text-[length:var(--text-sm)] text-success-text">
                {notice}
              </p>
            )}
          </div>

          <Button
            type="submit"
            variant="primary"
            loading={loading}
            disabled={submitDisabled}
            className="self-start"
          >
            Import Article
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}
