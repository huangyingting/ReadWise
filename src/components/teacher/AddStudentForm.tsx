"use client";

import { useEffect, useMemo, useState } from "react";
import { postJson } from "@/lib/client-fetch";
import { Input } from "@/components/ui/Input";
import { Field } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { useMutation } from "@/hooks/useMutation";
import { TeacherFormShell } from "./TeacherFormShell";

type StudentCandidate = {
  id: string;
  name: string | null;
  email: string | null;
  image?: string | null;
};

interface AddStudentFormProps {
  classroomId: string;
  initialCandidates: StudentCandidate[];
}

const STUDENT_QUERY_MAX_LENGTH = 100;

function candidateLabel(candidate: StudentCandidate): string {
  return candidate.name
    ? `${candidate.name}${candidate.email ? ` · ${candidate.email}` : ""}`
    : candidate.email ?? "Unnamed student";
}

function candidateMatches(candidate: StudentCandidate, query: string): boolean {
  if (!query) return true;
  const haystack = `${candidate.name ?? ""} ${candidate.email ?? ""}`.toLowerCase();
  return haystack.includes(query.toLowerCase());
}

export default function AddStudentForm({
  classroomId,
  initialCandidates,
}: AddStudentFormProps) {
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState(initialCandidates);
  const [selected, setSelected] = useState<StudentCandidate | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const { busy, error, run } = useMutation("Failed to add student");
  const trimmedQuery = query.trim();

  useEffect(() => {
    const controller = new AbortController();
    const url = new URL(
      `/api/classrooms/${classroomId}/student-candidates`,
      window.location.origin,
    );
    if (trimmedQuery) url.searchParams.set("q", trimmedQuery);

    setSearchError(null);
    fetch(url, { signal: controller.signal, headers: { accept: "application/json" } })
      .then(async (res) => {
        if (!res.ok) throw new Error("Student search failed");
        return (await res.json()) as { candidates: StudentCandidate[] };
      })
      .then((data) => setCandidates(data.candidates))
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setSearchError("Could not refresh student results. Showing recent matches.");
      });

    return () => controller.abort();
  }, [classroomId, trimmedQuery]);

  const visibleCandidates = useMemo(
    () => candidates.filter((candidate) => candidateMatches(candidate, trimmedQuery)),
    [candidates, trimmedQuery],
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;
    await run(async () => {
      await postJson(`/api/classrooms/${classroomId}/members`, {
        userId: selected.id,
        role: "Student",
      });
      setQuery("");
      setSelected(null);
    }, { refreshOnSuccess: true });
  }

  return (
    <TeacherFormShell
      onSubmit={submit}
      busy={busy}
      canSubmit={!!selected}
      submitLabel="Add student"
      busyLabel="Adding…"
    >
      <Field label="Find student by name or email" error={error ?? searchError ?? undefined}>
        <Input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelected(null);
          }}
          placeholder="Search students…"
          maxLength={STUDENT_QUERY_MAX_LENGTH}
          aria-describedby="student-picker-help"
        />
      </Field>
      <p id="student-picker-help" className="text-[length:var(--text-xs)] text-text-muted">
        Choose a result before adding them to this classroom.
      </p>
      <div
        role="group"
        aria-label="Student search results"
        className="flex max-h-[calc(var(--space-6)*8)] flex-col gap-[var(--space-2)] overflow-y-auto"
      >
        {visibleCandidates.length > 0 ? (
          visibleCandidates.map((candidate) => {
            const isSelected = selected?.id === candidate.id;
            return (
              <Button
                key={candidate.id}
                type="button"
                variant={isSelected ? "secondary" : "outline"}
                size="sm"
                aria-pressed={isSelected}
                className="h-auto w-full justify-start whitespace-normal py-[var(--space-2)] text-left"
                onClick={() => setSelected(candidate)}
              >
                {candidateLabel(candidate)}
              </Button>
            );
          })
        ) : (
          <p className="text-[length:var(--text-sm)] text-text-muted">
            No matching students found.
          </p>
        )}
      </div>
    </TeacherFormShell>
  );
}
