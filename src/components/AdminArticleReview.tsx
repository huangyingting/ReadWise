"use client";

import { useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { useMutation } from "@/hooks/useMutation";
import { postJson } from "@/lib/client-fetch";
import { Button } from "@/components/ui/Button";
import { IconButton } from "@/components/ui/IconButton";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Select } from "@/components/ui/Select";
import { Field } from "@/components/ui/Field";
import { CATEGORIES } from "@/lib/categories";

const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;
const STATUS_OPTIONS = [
  { value: "DRAFT", label: "Draft" },
  { value: "PUBLISHED", label: "Published" },
] as const;
const VISIBILITY_OPTIONS = [
  { value: "PUBLIC", label: "Public" },
  { value: "UNLISTED", label: "Unlisted (hidden from feeds)" },
] as const;

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
    visibility: string;
    reviewState: string;
    qualityFlags: string[];
    tags: string;
  };
};

type PublicationStatus = AdminArticleReviewProps["initial"]["status"];
/** The operator-settable public-library visibility subset (PRIVATE/ORG excluded). */
type VisibilityChoice = "PUBLIC" | "UNLISTED";

function humanizeFlag(flag: string): string {
  return flag.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function toggleSelection(items: string[], item: string): string[] {
  return items.includes(item) ? items.filter((value) => value !== item) : [...items, item];
}

function parseTagList(tags: string): string[] {
  return tags
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

/** Appends `value` (trimmed) to `tags` unless a case-insensitive match exists. PURE. */
function addTagTo(tags: string[], value: string): string[] {
  const next = value.trim();
  if (next.length === 0) return tags;
  const exists = tags.some((tag) => tag.toLowerCase() === next.toLowerCase());
  return exists ? tags : [...tags, next];
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
  const [status, setStatus] = useState<PublicationStatus>(initial.status);
  // Visibility is only operator-editable for the ownerless public-library states
  // (PUBLIC/UNLISTED). PRIVATE/ORG are owner/organization-scoped and shown
  // read-only — the guard in reviewArticle rejects a change server-side too.
  const visibilityEditable = initial.visibility === "PUBLIC" || initial.visibility === "UNLISTED";
  const [visibility, setVisibility] = useState<VisibilityChoice>(
    visibilityEditable ? (initial.visibility as VisibilityChoice) : "PUBLIC",
  );
  const [reviewState, setReviewState] = useState(initial.reviewState);
  const [flags, setFlags] = useState<string[]>(initial.qualityFlags);
  const [tags, setTags] = useState<string[]>(() => parseTagList(initial.tags));
  const [tagInput, setTagInput] = useState("");
  const [note, setNote] = useState("");

  const { busy, error, run } = useMutation("Review failed");
  const [savedAt, setSavedAt] = useState<number | null>(null);

  function toggleFlag(flag: string) {
    setFlags((prev) => toggleSelection(prev, flag));
  }

  function addTag(value: string) {
    setTags((prev) => addTagTo(prev, value));
    setTagInput("");
  }

  function removeTag(tag: string) {
    setTags((prev) => prev.filter((value) => value !== tag));
  }

  function onTagInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      // Enter adds a chip — it must NOT submit the surrounding form.
      event.preventDefault();
      addTag(tagInput);
    }
  }

  async function save() {
    await run(async () => {
      await postJson(`/api/admin/articles/${articleId}/review`, {
        title,
        excerpt,
        category,
        difficulty,
        status,
        ...(visibilityEditable ? { visibility } : {}),
        reviewState,
        qualityFlags: flags,
        tags,
        note: note.trim() || undefined,
      });
      setNote("");
      setSavedAt(Date.now());
      router.refresh();
    });
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
            onChange={(e) => setStatus(e.target.value as PublicationStatus)}
            selectSize="md"
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {visibilityEditable ? (
        <Field
          label="Visibility"
          hint="Unlisted hides the article from public feeds and listings but keeps it reachable by direct link."
        >
          <Select
            value={visibility}
            onChange={(e) => setVisibility(e.target.value as VisibilityChoice)}
            selectSize="md"
          >
            {VISIBILITY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </Select>
        </Field>
      ) : (
        <Field label="Visibility">
          <p className="muted text-[length:var(--text-sm)] m-0">
            {initial.visibility} — owned or organization article. Visibility is managed
            with its owner/organization, not from the public moderation queue.
          </p>
        </Field>
      )}

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

      <Field
        label="Tags"
        hint="Add or remove tags. Replaces the article's tags on save."
      >
        <div className="flex flex-col gap-[var(--space-2)]">
          {tags.length > 0 && (
            <ul className="flex flex-wrap gap-[var(--space-2)] list-none p-0 m-0">
              {tags.map((tag) => (
                <li key={tag}>
                  <Badge variant="neutral" className="pr-[var(--space-1)]">
                    <span>{tag}</span>
                    <IconButton
                      type="button"
                      size="sm"
                      aria-label={`Remove tag ${tag}`}
                      onClick={() => removeTag(tag)}
                    >
                      <X className="size-3" aria-hidden="true" />
                    </IconButton>
                  </Badge>
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-center gap-[var(--space-2)]">
            <Input
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={onTagInputKeyDown}
              inputSize="md"
              placeholder="Add a tag…"
              aria-label="Add a tag"
            />
            <Button
              type="button"
              variant="secondary"
              size="md"
              className="w-auto"
              disabled={!tagInput.trim()}
              onClick={() => addTag(tagInput)}
            >
              Add
            </Button>
          </div>
        </div>
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
