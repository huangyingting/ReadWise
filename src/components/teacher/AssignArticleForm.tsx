"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { getJson, postJson } from "@/lib/client-fetch";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Field } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { useMutation } from "@/hooks/useMutation";
import { useFilteredFetch } from "@/hooks/useFilteredFetch";
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
  students: { id: string; label: string }[];
}

type ArticleOptionsResponse = {
  articles: ArticleOption[];
};

type BulkAssignmentResponse = {
  created: unknown[];
  failed: { articleId: string; reason: string }[];
};

const ARTICLE_QUERY_MAX_LENGTH = 100;
const TITLE_MAX_LENGTH = 200;
const INSTRUCTIONS_MAX_LENGTH = 2000;
const EMPTY_ASSIGNMENT_FORM = {
  title: "",
  points: "",
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

function articleOptionsUrl(classroomId: string, query: string): string {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  const qs = params.toString();
  return `/api/classrooms/${classroomId}/article-options${qs ? `?${qs}` : ""}`;
}

function buildAssignmentPayload(
  articleId: string,
  dueDate: string,
  instructions: string,
  title: string,
  points: string,
  studentIds?: string[],
) {
  return {
    articleId,
    title: title.trim() || undefined,
    points: points ? Number(points) : undefined,
    dueDate: dueDate || undefined,
    instructions: instructions.trim() || undefined,
    studentIds,
  };
}

export default function AssignArticleForm({
  classroomId,
  initialArticles,
  students,
}: AssignArticleFormProps) {
  const [form, setForm] = useState(EMPTY_ASSIGNMENT_FORM);
  const [query, setQuery] = useState("");
  const [articles, setArticles] = useState(initialArticles);
  const [selected, setSelected] = useState<ArticleOption[]>([]);
  const [audience, setAudience] = useState<"class" | "students">("class");
  const [targetIds, setTargetIds] = useState<string[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const { busy, error, run } = useMutation("Failed to assign article");
  const { run: runArticleSearch } = useFilteredFetch<ArticleOptionsResponse>(0);
  const trimmedQuery = query.trim();

  useEffect(() => {
    setSearchError(null);
    runArticleSearch({
      fetcher: (signal) =>
        getJson<ArticleOptionsResponse>(
          articleOptionsUrl(classroomId, trimmedQuery),
          { signal },
        ),
      onResult: (data) => {
        setArticles(data.articles);
      },
      onError: () => {
        setSearchError("Could not refresh article results. Showing recent matches.");
      },
    });
  }, [classroomId, trimmedQuery, runArticleSearch]);

  useEffect(() => {
    if (selected.length !== 1) {
      setAudience("class");
      setTargetIds([]);
    }
  }, [selected.length]);

  const visibleArticles = useMemo(
    () => articles.filter((article) => articleMatches(article, trimmedQuery)),
    [articles, trimmedQuery],
  );

  function resetForm() {
    setForm(EMPTY_ASSIGNMENT_FORM);
    setQuery("");
    setSelected([]);
    setAudience("class");
    setTargetIds([]);
  }

  function toggleArticle(article: ArticleOption) {
    setSelected((current) =>
      current.some((item) => item.id === article.id)
        ? current.filter((item) => item.id !== article.id)
        : [...current, article],
    );
  }

  function updateField(field: AssignmentFormField, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function toggleTarget(studentId: string) {
    setTargetIds((current) =>
      current.includes(studentId)
        ? current.filter((id) => id !== studentId)
        : [...current, studentId],
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (selected.length === 0) return;
    if (selected.length === 1 && audience === "students" && targetIds.length === 0) return;

    await run(async () => {
      setStatus(null);
      if (selected.length === 1) {
        const studentIds =
          audience === "students" && targetIds.length > 0 ? targetIds : undefined;
        await postJson(
          `/api/classrooms/${classroomId}/assignments`,
          buildAssignmentPayload(
            selected[0].id,
            form.dueDate,
            form.instructions,
            form.title,
            form.points,
            studentIds,
          ),
        );
      } else {
        const result = await postJson<BulkAssignmentResponse>(
          `/api/classrooms/${classroomId}/assignments/bulk`,
          {
            articleIds: selected.map((article) => article.id),
            points: form.points ? Number(form.points) : undefined,
            dueDate: form.dueDate || undefined,
            instructions: form.instructions.trim() || undefined,
          },
        );
        if (result.failed.length > 0) {
          setStatus(
            `Assigned ${result.created.length}, ${result.failed.length} could not be assigned.`,
          );
        }
      }
      resetForm();
    }, { refreshOnSuccess: true });
  }

  const submitLabel = selected.length > 1
    ? `Assign ${selected.length} articles`
    : "Assign article";
  const canSubmit =
    selected.length >= 1 &&
    !(selected.length === 1 && audience === "students" && targetIds.length === 0);

  return (
    <TeacherFormShell
      onSubmit={submit}
      busy={busy}
      canSubmit={canSubmit}
      submitLabel={submitLabel}
      busyLabel="Assigning…"
      buttonSize="md"
    >
      <Field label="Find article" error={error ?? searchError ?? undefined}>
        <Input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
          }}
          placeholder="Search title, author or source…"
          maxLength={ARTICLE_QUERY_MAX_LENGTH}
          aria-describedby="article-picker-help"
        />
      </Field>
      <p id="article-picker-help" className="text-[length:var(--text-xs)] text-text-muted">
        Choose an article before assigning it to the class.
      </p>
      <p className="m-0 text-[length:var(--text-xs)] text-text-muted">
        {selected.length} selected
      </p>
      <div
        role="group"
        aria-label="Article search results"
        className="flex max-h-[calc(var(--space-6)*8)] flex-col gap-[var(--space-2)] overflow-y-auto"
      >
        {visibleArticles.length > 0 ? (
          visibleArticles.map((article) => {
            const isSelected = selected.some((item) => item.id === article.id);
            const meta = articleMeta(article);
            return (
              <Button
                key={article.id}
                type="button"
                variant={isSelected ? "secondary" : "outline"}
                size="sm"
                aria-pressed={isSelected}
                className="h-auto w-full justify-start whitespace-normal py-[var(--space-2)] text-left"
                onClick={() => toggleArticle(article)}
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
      {selected.length === 1 ? (
        <>
          <Field label="Assign to">
            <div className="flex flex-col gap-[var(--space-2)]">
              <div
                role="group"
                aria-label="Assignment audience"
                className="flex flex-wrap gap-[var(--space-2)]"
              >
                <Button
                  type="button"
                  variant={audience === "class" ? "secondary" : "outline"}
                  size="sm"
                  aria-pressed={audience === "class"}
                  onClick={() => setAudience("class")}
                >
                  Whole class
                </Button>
                <Button
                  type="button"
                  variant={audience === "students" ? "secondary" : "outline"}
                  size="sm"
                  aria-pressed={audience === "students"}
                  onClick={() => setAudience("students")}
                >
                  Specific students
                </Button>
              </div>
              {audience === "students" ? (
                <div className="flex flex-col gap-[var(--space-2)]">
                  <p className="m-0 text-[length:var(--text-xs)] text-text-muted">
                    <Badge variant="neutral">{targetIds.length} selected</Badge>
                  </p>
                  <div
                    role="group"
                    aria-label="Target students"
                    className="flex max-h-[calc(var(--space-6)*8)] flex-col gap-[var(--space-2)] overflow-y-auto"
                  >
                    {students.length > 0 ? (
                      students.map((student) => {
                        const isTargeted = targetIds.includes(student.id);
                        return (
                          <Button
                            key={student.id}
                            type="button"
                            variant={isTargeted ? "secondary" : "outline"}
                            size="sm"
                            aria-pressed={isTargeted}
                            className="h-auto w-full justify-start whitespace-normal py-[var(--space-2)] text-left"
                            onClick={() => toggleTarget(student.id)}
                          >
                            {student.label}
                          </Button>
                        );
                      })
                    ) : (
                      <p className="m-0 text-[length:var(--text-sm)] text-text-muted">
                        No students are enrolled yet.
                      </p>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          </Field>
          <Field label="Title (optional)">
            <Input
              value={form.title}
              onChange={(e) => updateField("title", e.target.value)}
              placeholder="Override the article title for this class"
              maxLength={TITLE_MAX_LENGTH}
            />
          </Field>
        </>
      ) : null}
      <Field label="Points (optional)">
        <Input
          type="number"
          min={0}
          max={10000}
          step={1}
          value={form.points}
          onChange={(e) => updateField("points", e.target.value)}
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
      {status ? (
        <p aria-live="polite" className="m-0 text-[length:var(--text-sm)] text-text-muted">
          {status}
        </p>
      ) : null}
    </TeacherFormShell>
  );
}
