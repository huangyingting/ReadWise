"use client";

import { FormEvent, useState } from "react";
import { UserPlus } from "lucide-react";
import { Field, Input, Stack } from "@/components/ui";
import { Notice } from "@/components/ui/Notice";
import {
  AuthSubmitButton,
  EmailField,
  NewPasswordFields,
  PASSWORD_MISMATCH_MESSAGE,
  readConfirmedPassword,
} from "@/components/auth/AuthFormParts";
import { useMutation } from "@/hooks/useMutation";
import { postJson } from "@/lib/client-fetch";

export default function RegisterForm() {
  const { busy, error, setError, run } = useMutation("Registration could not be started.");
  const [complete, setComplete] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = readConfirmedPassword(form);
    if (password === null) {
      setError(PASSWORD_MISMATCH_MESSAGE);
      return;
    }
    await run(
      () =>
        postJson("/api/auth/register", {
          name: String(form.get("name") ?? ""),
          email: String(form.get("email") ?? ""),
          password,
        }),
      { onSuccess: () => setComplete(true) },
    );
  }

  if (complete) {
    return (
      <Notice tone="success">
        Check your email for a verification link. The link expires in 24 hours.
      </Notice>
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      <Stack gap="3">
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <Field label="Name">
          <Input name="name" type="text" autoComplete="name" maxLength={120} />
        </Field>
        <EmailField />
        <NewPasswordFields />
        <AuthSubmitButton pending={busy} icon={<UserPlus size={18} aria-hidden />}>
          Create account
        </AuthSubmitButton>
      </Stack>
    </form>
  );
}
