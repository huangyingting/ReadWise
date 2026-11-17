"use client";

/**
 * Text Set editor (#1308): title, essential question, student framing,
 * teacher notes, sharing, and an ordered list of readings with per-item
 * guiding notes. Articles come from the organization-scoped search.
 */

import { useEffect, useState, type SubmitEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import { getJson, patchJson, postJson, clientErrorMessage } from "@/lib/client-fetch";
import { useFilteredFetch } from "@/hooks/useFilteredFetch";
import {
  Badge,
  Button,
  Field,
  IconButton,
  Input,
  PanelError,
  Select,
  Textarea,
} from "@/components/ui";

const MAX_ITEMS = 20;

type ArticleOption = { id: string; title: string; source: string | null; difficulty: string | null };
type Item = ArticleOption & { guidingNote: string };

export type TextSetEditorInitial = {
  id: string;
  organizationId: string;
  title: string;
  essentialQuestion: string | null;
  description: string | null;
  educatorNotes: string | null;
  visibility: "PRIVATE" | "ORG";
  items: Array<{ articleId: string; title: string; source: string | null; difficulty: string | null; guidingNote: string | null }>;
};

interface TextSetEditorProps {
  /** Organizations the teacher can author in (create mode). */
  organizations: Array<{ id: string; name: string }>;
  /** Existing set to edit; omitted when creating. */
  initial?: TextSetEditorInitial;
}

function move<T>(list: T[], from: number, to: number): T[] {
  const next = [...list];
  const [entry] = next.splice(from, 1);
  next.splice(to, 0, entry!);
  return next;
}

export default function TextSetEditor({ organizations, initial }: TextSetEditorProps) {
  const router = useRouter();
  const [organizationId, setOrganizationId] = useState(initial?.organizationId ?? organizations[0]?.id ?? "");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [essentialQuestion, setEssentialQuestion] = useState(initial?.essentialQuestion ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [educatorNotes, setEducatorNotes] = useState(initial?.educatorNotes ?? "");
  const [visibility, setVisibility] = useState<"PRIVATE" | "ORG">(initial?.visibility ?? "PRIVATE");
  const [items, setItems] = useState<Item[]>(
    () =>
      initial?.items.map((item) => ({
        id: item.articleId,
        title: item.title,
        source: item.source,
        difficulty: item.difficulty,
        guidingNote: item.guidingNote ?? "",
      })) ?? [],
  );
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ArticleOption[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const { run: runSearch } = useFilteredFetch<{ articles: ArticleOption[] }>(200);

  useEffect(() => {
    if (!organizationId) return;
    setSearchError(null);
    const params = new URLSearchParams({ organizationId, q: query.trim() });
    runSearch({
      fetcher: (signal) => getJson<{ articles: ArticleOption[] }>(`/api/text-sets/article-options?${params}`, { signal }),
      onResult: (data) => setResults(data.articles),
      onError: () => setSearchError("Couldn’t search articles. Try again."),
    });
  }, [organizationId, query, runSearch]);

  const selectedIds = new Set(items.map((item) => item.id));

  function addItem(article: ArticleOption) {
    if (selectedIds.has(article.id) || items.length >= MAX_ITEMS) return;
    setItems((current) => [...current, { ...article, guidingNote: "" }]);
    setSaved(false);
  }

  function updateItems(next: Item[]) {
    setItems(next);
    setSaved(false);
  }

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    if (!title.trim() || items.length === 0) {
      setError("Add a title and at least one article.");
      return;
    }
    setPending(true);
    setError(null);
    const body = {
      title,
      essentialQuestion: essentialQuestion || null,
      description: description || null,
      educatorNotes: educatorNotes || null,
      visibility,
      items: items.map((item) => ({ articleId: item.id, guidingNote: item.guidingNote || null })),
    };
    try {
      if (initial) {
        await patchJson(`/api/text-sets/${encodeURIComponent(initial.id)}`, body);
        setSaved(true);
        router.refresh();
      } else {
        const created = await postJson<{ id: string }>("/api/text-sets", { organizationId, ...body });
        router.push(`/teacher/text-sets/${encodeURIComponent(created.id)}`);
      }
    } catch (err) {
      setError(clientErrorMessage(err, "Couldn’t save the text set."));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-[var(--space-5)]" noValidate>
      {!initial && organizations.length > 1 ? (
        <Field label="Organization">
          <Select
            value={organizationId}
            onChange={(event) => {
              setOrganizationId(event.target.value);
              setItems([]);
            }}
          >
            {organizations.map((org) => (
              <option key={org.id} value={org.id}>
                {org.name}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      <Field label="Title" required>
        <Input value={title} maxLength={200} onChange={(event) => setTitle(event.target.value)} />
      </Field>
      <Field label="Essential question" hint="The question students explore across the readings.">
        <Input
          value={essentialQuestion}
          maxLength={500}
          placeholder="How do ecosystems recover after wildfire?"
          onChange={(event) => setEssentialQuestion(event.target.value)}
        />
      </Field>
      <Field label="Student instructions" hint="Shown to students with every reading in the set.">
        <Textarea value={description} maxLength={2000} rows={3} onChange={(event) => setDescription(event.target.value)} />
      </Field>
      <Field label="Teacher notes" hint="Only teachers see these.">
        <Textarea value={educatorNotes} maxLength={4000} rows={3} onChange={(event) => setEducatorNotes(event.target.value)} />
      </Field>
      <Field label="Sharing" hint="Shared sets are visible to teachers in this organization only.">
        <Select value={visibility} onChange={(event) => setVisibility(event.target.value as "PRIVATE" | "ORG")}>
          <option value="PRIVATE">Private</option>
          <option value="ORG">Shared with my organization</option>
        </Select>
      </Field>

      <section aria-labelledby="text-set-readings" className="flex flex-col gap-[var(--space-3)]">
        <h2 id="text-set-readings" className="m-0 text-[length:var(--type-section-title-compact)] font-semibold text-text">
          Readings ({items.length}/{MAX_ITEMS})
        </h2>
        {items.length === 0 ? (
          <p className="m-0 text-[length:var(--type-ui)] text-text-muted">Search below and add articles in reading order.</p>
        ) : (
          <ol className="m-0 flex list-none flex-col gap-[var(--space-3)] p-0">
            {items.map((item, index) => (
              <li key={item.id} className="flex flex-col gap-[var(--space-2)] rounded-[var(--radius-md)] border border-border p-[var(--space-3)]">
                <div className="flex items-start justify-between gap-[var(--space-2)]">
                  <div className="flex min-w-0 flex-col">
                    <span className="font-medium text-text">
                      {index + 1}. {item.title}
                    </span>
                    <span className="text-[length:var(--type-label)] text-text-muted">
                      {item.source ?? "Unknown source"}
                      {item.difficulty ? ` · ${item.difficulty}` : ""}
                    </span>
                  </div>
                  <div className="flex shrink-0 gap-[var(--space-1)]">
                    <IconButton
                      aria-label={`Move ${item.title} up`}
                      disabled={index === 0}
                      onClick={() => updateItems(move(items, index, index - 1))}
                    >
                      <ArrowUp size={16} aria-hidden />
                    </IconButton>
                    <IconButton
                      aria-label={`Move ${item.title} down`}
                      disabled={index === items.length - 1}
                      onClick={() => updateItems(move(items, index, index + 1))}
                    >
                      <ArrowDown size={16} aria-hidden />
                    </IconButton>
                    <IconButton
                      aria-label={`Remove ${item.title}`}
                      onClick={() => updateItems(items.filter((entry) => entry.id !== item.id))}
                    >
                      <X size={16} aria-hidden />
                    </IconButton>
                  </div>
                </div>
                <Field label={`Guiding note for reading ${index + 1}`} hint="Optional — becomes this reading's instructions.">
                  <Input
                    value={item.guidingNote}
                    maxLength={1000}
                    onChange={(event) =>
                      updateItems(items.map((entry) => (entry.id === item.id ? { ...entry, guidingNote: event.target.value } : entry)))
                    }
                  />
                </Field>
              </li>
            ))}
          </ol>
        )}

        <Field label="Find articles">
          <Input
            type="search"
            value={query}
            placeholder="Search by title, author, or source"
            onChange={(event) => setQuery(event.target.value)}
          />
        </Field>
        {searchError ? <PanelError message={searchError} /> : null}
        <ul aria-label="Article search results" className="m-0 flex max-h-[calc(var(--space-6)*10)] list-none flex-col gap-[var(--space-2)] overflow-y-auto p-0">
          {results.map((article) => {
            const added = selectedIds.has(article.id);
            return (
              <li key={article.id} className="flex items-center justify-between gap-[var(--space-2)]">
                <span className="min-w-0 text-[length:var(--type-ui)] text-text">
                  {article.title}
                  {article.difficulty ? (
                    <Badge variant="neutral" className="ml-[var(--space-1)]">
                      {article.difficulty}
                    </Badge>
                  ) : null}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={added || items.length >= MAX_ITEMS}
                  leadingIcon={<Plus size={14} aria-hidden />}
                  aria-label={added ? `${article.title} added` : `Add ${article.title}`}
                  onClick={() => addItem(article)}
                >
                  {added ? "Added" : "Add"}
                </Button>
              </li>
            );
          })}
        </ul>
      </section>

      <div className="flex flex-wrap items-center gap-[var(--space-3)]">
        <Button type="submit" loading={pending}>
          {initial ? "Save changes" : "Create text set"}
        </Button>
        {saved ? (
          <p role="status" className="m-0 text-[length:var(--type-ui)] text-text-muted">
            Saved.
          </p>
        ) : null}
      </div>
      {error ? <PanelError message={error} /> : null}
    </form>
  );
}
