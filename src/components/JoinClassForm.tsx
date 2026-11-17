"use client";

/**
 * Class-code entry form (#1309). Redeems a teacher's join code for the
 * signed-in learner and links to their assignments on success. Used by the
 * `/join-class` page and the Settings "Classes" section.
 *
 * Malformed input is caught locally (no rate-limited request is spent on a
 * typo); the server's reason for a rejected code is shown on the field. Before
 * hydration the form falls back to a plain GET of `/join-class?code=…`, which
 * re-renders the form with the code kept instead of dropping it.
 */

import { useState, type SubmitEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ApiResponseError, clientErrorMessage, postJson } from "@/lib/client-fetch";
import { JOIN_CODE_INPUT_MAX_LENGTH, normalizeJoinCode } from "@/lib/classroom/join-code-format";
import { Button, Field, Input, PanelError } from "@/components/ui";

type JoinResponse = {
  ok: true;
  alreadyMember: boolean;
  classroom: { id: string; name: string };
};

const FORMAT_HINT = "Class codes are 8 letters and numbers, like ABCD-2345.";
/** Statuses whose message describes the code itself (invalid, expired, full, archived). */
const CODE_ERROR_STATUSES = new Set([400, 404, 409, 410]);

interface JoinClassFormProps {
  initialCode?: string;
  /** Visible field label; also the input's accessible name. */
  label?: string;
}

export default function JoinClassForm({ initialCode = "", label = "Class code" }: JoinClassFormProps) {
  const router = useRouter();
  const [code, setCode] = useState(initialCode);
  const [pending, setPending] = useState(false);
  const [joined, setJoined] = useState<JoinResponse | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || code.trim().length === 0) return;
    setJoined(null);
    setError(null);
    if (!normalizeJoinCode(code)) {
      setCodeError(FORMAT_HINT);
      return;
    }
    setPending(true);
    setCodeError(null);
    try {
      const res = await postJson<JoinResponse>("/api/classrooms/join", { code: code.trim() });
      setJoined(res);
      setCode("");
      router.refresh();
    } catch (err) {
      if (err instanceof ApiResponseError && CODE_ERROR_STATUSES.has(err.status)) {
        setCodeError(err.message);
      } else {
        setError(clientErrorMessage(err, "Couldn’t join the class. Try again."));
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      action="/join-class"
      method="get"
      onSubmit={submit}
      className="flex flex-col gap-[var(--space-3)]"
      noValidate
    >
      <Field
        label={label}
        hint="Ask your teacher for the 8-character code, e.g. ABCD-2345."
        error={codeError ?? undefined}
      >
        <Input
          name="code"
          value={code}
          onChange={(event) => {
            setCode(event.target.value.toUpperCase());
            setCodeError(null);
          }}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={JOIN_CODE_INPUT_MAX_LENGTH}
          placeholder="ABCD-2345"
          className="font-mono tracking-widest"
        />
      </Field>
      <div>
        <Button type="submit" size="sm" loading={pending} disabled={pending || code.trim().length === 0}>
          Join class
        </Button>
      </div>
      {joined ? (
        <p role="status" className="m-0 text-[length:var(--type-ui)] text-text">
          {joined.alreadyMember ? "You’re already in " : "You joined "}
          <span className="font-semibold">{joined.classroom.name}</span>.{" "}
          <Link href="/assignments" className="font-medium text-primary-text underline-offset-2 hover:underline">
            See your assignments
          </Link>
        </p>
      ) : null}
      {error ? <PanelError message={error} /> : null}
    </form>
  );
}
