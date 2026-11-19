"use client";

import { FormEvent, useState } from "react";
import { Mail } from "lucide-react";
import { Stack } from "@/components/ui";
import { Notice } from "@/components/ui/Notice";
import { AuthSubmitButton, EmailField } from "@/components/auth/AuthFormParts";
import { useMutation } from "@/hooks/useMutation";
import { postJson } from "@/lib/client-fetch";

export default function ForgotPasswordForm() {
  const { busy, error, run } = useMutation("The reset request could not be completed.");
  const [complete, setComplete] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await run(
      () => postJson("/api/auth/password/forgot", { email: String(form.get("email") ?? "") }),
      { onSuccess: () => setComplete(true) },
    );
  }

  if (complete) {
    return (
      <Notice tone="success">
        If a password account exists for that email, a reset link is on its
        way.
      </Notice>
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      <Stack gap="3">
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <EmailField />
        <AuthSubmitButton pending={busy} icon={<Mail size={18} aria-hidden />}>
          Send reset link
        </AuthSubmitButton>
      </Stack>
    </form>
  );
}
