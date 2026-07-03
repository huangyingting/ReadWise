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
const DUPLICATE_REDIRECT_DELAY_MS = 1500;
const TEXT_IMPORT_REDIRECT_DELAY_MS = 1200;

type Mode = "url" | "text";
type ImportResponse = { duplicate?: boolean; id: string };

const MODE_OPTIONS = [
  { value: "url" as const, label: "Paste URL" },
  { value: "text" as const, label: "Paste Text" },
] as const;

function countWords(t: string): number {
  return t.trim() ? t.trim().split(/\s+/).filter(Boolean).length : 0;
}

function createImportBody(mode: Mode, url: string, title: string, text: string) {
  return mode === "url"
    ? { url: url.trim() }
    : { title: title.trim() || undefined, text };
}

function getImportErrorMessage(err: unknown): string {
  if (err instanceof ApiResponseError) {
    return err.message || "Import failed. Please try again.";
  }
  return "Network error. Please try again.";
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
  const hasText = text.trim().length > 0;
  const isTextMode = mode === "text";
  const textBelowMin = isTextMode && hasText && textWordCount < MIN_IMPORT_WORDS;
  const submitDisabled =
    loading ||
    (mode === "url" && !url.trim()) ||
    (isTextMode && (!hasText || textWordCount < MIN_IMPORT_WORDS));

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
      const data = await postJson<ImportResponse>(
        "/api/articles/import",
        createImportBody(mode, url, title, text),
      );
      const readerPath = `/reader/${data.id}`;

      if (data.duplicate) {
        // Re-import of an existing article — let the user know before opening.
        setNotice("You've already imported this article — opening it now.");
        setTimeout(() => router.push(readerPath), DUPLICATE_REDIRECT_DELAY_MS);
      } else if (isTextMode) {
        // Text paste — show a brief confirmation before navigating.
        setNotice("Article imported successfully! Opening reader…");
        setTimeout(() => router.push(readerPath), TEXT_IMPORT_REDIRECT_DELAY_MS);
      } else {
        router.push(readerPath);
      }
    } catch (err) {
      setError(getImportErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardBody>
        {/* Mode selector */}
        <div className="mb-[var(--space-5)]">
          <SegmentedControl
            label="Import mode"
            value={mode}
            onChange={setMode}
            options={MODE_OPTIONS}
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
