"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { postJson } from "@/lib/client-fetch";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Field } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { useMutation } from "@/hooks/useMutation";
import { TeacherFormShell } from "./TeacherFormShell";

type ArticleOption = {
  id: string;
  title: string;
  author: string | null;
  source: string | null;
  difficulty: string | null;
};

interface AssignArticleFormProps {
  classroomId: string;
  initialArticles: ArticleOption[];
}

const ARTICLE_QUERY_MAX_LENGTH = 100;
const INSTRUCTIONS_MAX_LENGTH = 2000;
const EMPTY_ASSIGNMENT_FORM = {
  dueDate: "",
  instructions: "",
};

type AssignmentFormField = keyof typeof EMPTY_ASSIGNMENT_FORM;

function articleMeta(article: ArticleOption): string {
  return [article.author, article.source].filter(Boolean).join(" · ");
}

function articleMatches(article: ArticleOption, query: string): boolean {
  if (!query) return true;
  const haystack = `${article.title} ${article.author ?? ""} ${article.source ?? ""}`.toLowerCase();
  return haystack.includes(query.toLowerCase());
}

function buildAssignmentPayload(
  articleId: string,
  dueDate: string,
  instructions: string,
) {
  return {
    articleId,
    dueDate: dueDate ? new Date(dueDate).toISOString() : undefined,
    instructions: instructions.trim() || undefined,
  };
}

export default function AssignArticleForm({
  classroomId,
  initialArticles,
}: AssignArticleFormProps) {
  const [form, setForm] = useState(EMPTY_ASSIGNMENT_FORM);
  const [query, setQuery] = useState("");
  const [articles, setArticles] = useState(initialArticles);
  const [selected, setSelected] = useState<ArticleOption | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const { busy, error, run } = useMutation("Failed to assign article");
  const trimmedQuery = query.trim();

  useEffect(() => {
    const controller = new AbortController();
    const url = new URL(
      `/api/classrooms/${classroomId}/article-options`,
      window.location.origin,
    );
    if (trimmedQuery) url.searchParams.set("q", trimmedQuery);

    setSearchError(null);
    fetch(url, { signal: controller.signal, headers: { accept: "application/json" } })
      .then(async (res) => {
        if (!res.ok) throw new Error("Article search failed");
        return (await res.json()) as { articles: ArticleOption[] };
      })
      .then((data) => setArticles(data.articles))
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setSearchError("Could not refresh article results. Showing recent matches.");
      });

    return () => controller.abort();
  }, [classroomId, trimmedQuery]);

  const visibleArticles = useMemo(
    () => articles.filter((article) => articleMatches(article, trimmedQuery)),
    [articles, trimmedQuery],
  );

  function resetForm() {
    setForm(EMPTY_ASSIGNMENT_FORM);
    setQuery("");
    setSelected(null);
  }

  function updateField(field: AssignmentFormField, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!selected) return;

    await run(async () => {
      await postJson(
        `/api/classrooms/${classroomId}/assignments`,
        buildAssignmentPayload(selected.id, form.dueDate, form.instructions),
      );
      resetForm();
    }, { refreshOnSuccess: true });
  }

  return (
    <TeacherFormShell
      onSubmit={submit}
      busy={busy}
      canSubmit={!!selected}
      submitLabel="Assign article"
      busyLabel="Assigning…"
      buttonSize="md"
    >
      <Field label="Find article" error={error ?? searchError ?? undefined}>
        <Input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelected(null);
          }}
          placeholder="Search title, author or source…"
          maxLength={ARTICLE_QUERY_MAX_LENGTH}
          aria-describedby="article-picker-help"
        />
      </Field>
      <p id="article-picker-help" className="text-[length:var(--text-xs)] text-text-muted">
        Choose an article before assigning it to the class.
      </p>
      <div
        role="group"
        aria-label="Article search results"
        className="flex max-h-[calc(var(--space-6)*8)] flex-col gap-[var(--space-2)] overflow-y-auto"
      >
        {visibleArticles.length > 0 ? (
          visibleArticles.map((article) => {
            const isSelected = selected?.id === article.id;
            const meta = articleMeta(article);
            return (
              <Button
                key={article.id}
                type="button"
                variant={isSelected ? "secondary" : "outline"}
                size="sm"
                aria-pressed={isSelected}
                className="h-auto w-full justify-start whitespace-normal py-[var(--space-2)] text-left"
                onClick={() => setSelected(article)}
              >
                <span className="flex flex-col items-start gap-[var(--space-1)]">
                  <span>{article.title}</span>
                  <span className="font-normal text-text-muted">
                    {meta || "Unknown source"}
                    {article.difficulty ? (
                      <Badge variant="neutral" className="ml-[var(--space-1)]">
                        {article.difficulty}
                      </Badge>
                    ) : null}
                  </span>
                </span>
              </Button>
            );
          })
        ) : (
          <p className="text-[length:var(--text-sm)] text-text-muted">
            No matching articles found.
          </p>
        )}
      </div>
      <Field label="Due date (optional)">
        <Input
          type="date"
          value={form.dueDate}
          onChange={(e) => updateField("dueDate", e.target.value)}
        />
      </Field>
      <Field label="Instructions (optional)">
        <Textarea
          value={form.instructions}
          onChange={(e) => updateField("instructions", e.target.value)}
          placeholder="What should students focus on?"
          rows={3}
          maxLength={INSTRUCTIONS_MAX_LENGTH}
        />
      </Field>
    </TeacherFormShell>
  );
}
