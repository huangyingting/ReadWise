"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Select } from "@/components/ui/Select";
import { Field } from "@/components/ui/Field";
import { CATEGORIES } from "@/lib/categories";

const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;

export type ReviewStateOption = { value: string; label: string };

export type AdminArticleReviewProps = {
  articleId: string;
  reviewStateOptions: ReviewStateOption[];
  qualityFlagOptions: string[];
  initial: {
    title: string;
    excerpt: string;
    category: string;
    difficulty: string;
    status: "DRAFT" | "PUBLISHED";
    reviewState: string;
    qualityFlags: string[];
    tags: string;
  };
};

function humanizeFlag(flag: string): string {
  return flag.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Inline moderation form (RW-048) on the admin article detail page. Lets a
 * moderator correct metadata (title, excerpt, category, difficulty, tags),
 * publication status, the review verdict, and quality flags in one action,
 * appending a review-history row server-side.
 */
export default function AdminArticleReview({
  articleId,
  reviewStateOptions,
  qualityFlagOptions,
  initial,
}: AdminArticleReviewProps) {
  const router = useRouter();
  const [title, setTitle] = useState(initial.title);
  const [excerpt, setExcerpt] = useState(initial.excerpt);
  const [category, setCategory] = useState(initial.category);
  const [difficulty, setDifficulty] = useState(initial.difficulty);
  const [status, setStatus] = useState<"DRAFT" | "PUBLISHED">(initial.status);
  const [reviewState, setReviewState] = useState(initial.reviewState);
  const [flags, setFlags] = useState<string[]>(initial.qualityFlags);
  const [tags, setTags] = useState(initial.tags);
  const [note, setNote] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  function toggleFlag(flag: string) {
    setFlags((prev) =>
      prev.includes(flag) ? prev.filter((f) => f !== flag) : [...prev, flag],
    );
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const tagList = tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      const res = await fetch(`/api/admin/articles/${articleId}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          excerpt,
          category,
          difficulty,
          status,
          reviewState,
          qualityFlags: flags,
          tags: tagList,
          note: note.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? `Review failed (${res.status})`);
      }
      setNote("");
      setSavedAt(Date.now());
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Review failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-[var(--space-4)]">
        <Field label="Review verdict">
          <Select
            value={reviewState}
            onChange={(e) => setReviewState(e.target.value)}
            selectSize="md"
          >
            {reviewStateOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Publication status">
          <Select
            value={status}
            onChange={(e) => setStatus(e.target.value as "DRAFT" | "PUBLISHED")}
            selectSize="md"
          >
            <option value="DRAFT">Draft</option>
            <option value="PUBLISHED">Published</option>
          </Select>
        </Field>
      </div>

      <Field label="Title">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} inputSize="md" />
      </Field>

      <Field label="Excerpt">
        <Textarea
          value={excerpt}
          onChange={(e) => setExcerpt(e.target.value)}
          rows={2}
        />
      </Field>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-[var(--space-4)]">
        <Field label="Category">
          <Select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            selectSize="md"
          >
            <option value="">— None —</option>
            {CATEGORIES.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Difficulty (CEFR)">
          <Select
            value={difficulty}
            onChange={(e) => setDifficulty(e.target.value)}
            selectSize="md"
          >
            <option value="">— Unassessed —</option>
            {LEVELS.map((lvl) => (
              <option key={lvl} value={lvl}>
                {lvl}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <Field label="Tags" hint="Comma-separated. Replaces the article's tags.">
        <Input value={tags} onChange={(e) => setTags(e.target.value)} inputSize="md" />
      </Field>

      {qualityFlagOptions.length > 0 && (
        <Field label="Quality flags">
          <div className="flex flex-wrap gap-[var(--space-3)]">
            {qualityFlagOptions.map((flag) => (
              <label
                key={flag}
                className="inline-flex items-center gap-[var(--space-2)] text-[length:var(--text-sm)]"
              >
                <input
                  type="checkbox"
                  checked={flags.includes(flag)}
                  onChange={() => toggleFlag(flag)}
                />
                {humanizeFlag(flag)}
              </label>
            ))}
          </div>
        </Field>
      )}

      <Field label="Review note (optional)">
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder="Why this verdict / what you changed…"
        />
      </Field>

      <div className="flex items-center gap-[var(--space-3)]">
        <Button variant="primary" size="md" onClick={save} disabled={busy} className="w-auto">
          {busy ? "Saving…" : "Save review"}
        </Button>
        {savedAt && !error && (
          <span className="text-success-text text-[length:var(--text-sm)]">Saved.</span>
        )}
      </div>

      {error && (
        <p className="text-danger-text text-[length:var(--text-sm)]" style={{ margin: 0 }}>
          {error}
        </p>
      )}
    </div>
  );
}
